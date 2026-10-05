package com.anonymous.ProtoWatch

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.CellInfo
import android.telephony.CellIdentityNr
import android.telephony.CellInfoGsm
import android.telephony.CellInfoLte
import android.telephony.CellInfoNr
import android.telephony.CellInfoWcdma
import android.telephony.PhoneStateListener
import android.telephony.SignalStrength
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.RandomAccessFile
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import kotlin.math.abs

class CellMonitorModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val telephonyManager: TelephonyManager =
        reactContext.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager

    private var listener: PhoneStateListener? = null
    private var lastTowerId: String? = null
    private var lastSignalDbm: Int? = null
    private val seenTowers = mutableSetOf<String>()
    private var diagIngestionExecutor: ScheduledExecutorService? = null
    private var diagLogPath: String = DEFAULT_DIAG_LOG_PATH
    private var diagOffset: Long = 0

    override fun getName(): String = "CellMonitor"

    @ReactMethod
    fun startMonitoring() {
        if (listener != null) return
        if (!hasRuntimePermissions()) return

        listener = object : PhoneStateListener() {
            override fun onSignalStrengthsChanged(signalStrength: SignalStrength?) {
                emitUpdate(signalStrength = signalStrength)
            }

            override fun onCellInfoChanged(cellInfo: MutableList<CellInfo>?) {
                emitUpdate(cellInfoList = cellInfo)
            }
        }

        @Suppress("DEPRECATION")
        telephonyManager.listen(
            listener,
            PhoneStateListener.LISTEN_SIGNAL_STRENGTHS or PhoneStateListener.LISTEN_CELL_INFO,
        )

        startDiagIngestion()
        emitUpdate()
    }

    @ReactMethod
    fun stopMonitoring() {
        stopDiagIngestion()
        listener?.let {
            @Suppress("DEPRECATION")
            telephonyManager.listen(it, PhoneStateListener.LISTEN_NONE)
        }
        listener = null
    }

    @ReactMethod
    fun setDiagLogPath(path: String) {
        if (path.isNotBlank()) {
            diagLogPath = path
            diagOffset = 0
        }
    }

    @ReactMethod
    fun startDiagIngestion() {
        if (diagIngestionExecutor != null) return

        diagIngestionExecutor = Executors.newSingleThreadScheduledExecutor().apply {
            scheduleAtFixedRate(
                {
                    ingestFromDiagLog()
                },
                0,
                DIAG_POLL_INTERVAL_MS,
                TimeUnit.MILLISECONDS,
            )
        }
    }

    @ReactMethod
    fun stopDiagIngestion() {
        diagIngestionExecutor?.shutdownNow()
        diagIngestionExecutor = null
    }

    @ReactMethod
    fun ingestDiagLine(line: String, towerId: String?, timestampMs: Double) {
        val evidence = DiagProtocolParser.parseLine(
            line = line,
            fallbackTowerId = towerId,
            timestampMs = timestampMs.toLong(),
        )
        if (evidence != null) {
            sendEvent("onProtocolEvidence", evidence)
        }
    }

    private fun emitUpdate(
        signalStrength: SignalStrength? = null,
        cellInfoList: List<CellInfo>? = null,
    ) {
        val currentInfo = cellInfoList ?: telephonyManager.allCellInfo
        val registered = currentInfo?.firstOrNull { it.isRegistered }
        val snapshot = mapCellInfo(registered)

        val dbm = signalStrength?.cellSignalStrengths?.firstOrNull()?.dbm ?: snapshot.signalStrength
        val now = System.currentTimeMillis()

        val isNewTower = snapshot.towerId.isNotEmpty() && !seenTowers.contains(snapshot.towerId)
        if (snapshot.towerId.isNotEmpty()) {
            seenTowers.add(snapshot.towerId)
        }

        val rapidTowerSwitch =
            !lastTowerId.isNullOrBlank() &&
                snapshot.towerId.isNotEmpty() &&
                lastTowerId != snapshot.towerId

        val signalJump = lastSignalDbm?.let { abs(dbm - it) > 20 } ?: false

        val payload = Arguments.createMap().apply {
            putString("towerId", snapshot.towerId.ifEmpty { "unknown" })
            putInt("lac", snapshot.lac)
            putString("mcc", snapshot.mcc)
            putString("mnc", snapshot.mnc)
            putString("generation", snapshot.generation)
            putInt("signalStrength", dbm)
            putBoolean("hasNullCipher", isNewTower && dbm > -70 && signalJump)
            putBoolean("hasAkaBypass", rapidTowerSwitch && dbm > -85)
            putBoolean("hasImsiRequest", false)
            putBoolean("hasRlfPrivacyLeak", false)
            putBoolean("forcedDowngrade", false)
            putDouble("timestamp", now.toDouble())
        }

        val protocolEvidence = Arguments.createMap().apply {
            putString("towerId", snapshot.towerId.ifEmpty { "unknown" })
            putDouble("timestamp", now.toDouble())
            putString("source", "diag_heuristic")
            putBoolean("hasNullCipher", isNewTower && dbm > -70 && signalJump)
            putBoolean("hasAkaBypass", rapidTowerSwitch && dbm > -85)
            putBoolean("hasImsiRequest", false)
            putBoolean("hasRlfPrivacyLeak", false)
            putBoolean("forcedDowngrade", false)
        }

        sendEvent("onSignalUpdate", payload)
        sendEvent("onProtocolEvidence", protocolEvidence)

        lastTowerId = snapshot.towerId
        lastSignalDbm = dbm
    }

    private fun ingestFromDiagLog() {
        try {
            val diagFile = File(diagLogPath)
            if (!diagFile.exists() || !diagFile.canRead()) return

            RandomAccessFile(diagFile, "r").use { raf ->
                if (diagOffset > raf.length()) {
                    // Log rotated/truncated; restart from beginning.
                    diagOffset = 0
                }

                raf.seek(diagOffset)

                var line = raf.readLine()
                while (line != null) {
                    val evidence = DiagProtocolParser.parseLine(
                        line = line,
                        fallbackTowerId = lastTowerId,
                        timestampMs = System.currentTimeMillis(),
                    )

                    if (evidence != null) {
                        sendEvent("onProtocolEvidence", evidence)
                    }

                    line = raf.readLine()
                }

                diagOffset = raf.filePointer
            }
        } catch (_: Exception) {
            // Keep monitoring alive even if DIAG ingestion hits transient read/parse errors.
        }
    }

    private fun hasRuntimePermissions(): Boolean {
        val readPhone = ContextCompat.checkSelfPermission(
            reactContext,
            Manifest.permission.READ_PHONE_STATE,
        ) == PackageManager.PERMISSION_GRANTED

        val fineLocation = ContextCompat.checkSelfPermission(
            reactContext,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED

        return readPhone && fineLocation
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    private fun mapCellInfo(cellInfo: CellInfo?): CellSnapshot {
        return when (cellInfo) {
            is CellInfoLte -> {
                val id = cellInfo.cellIdentity
                CellSnapshot(
                    towerId = id.ci.toString(),
                    lac = id.tac,
                    mcc = id.mccString ?: "",
                    mnc = id.mncString ?: "",
                    generation = "4G",
                    signalStrength = cellInfo.cellSignalStrength.dbm,
                )
            }

            is CellInfoGsm -> {
                val id = cellInfo.cellIdentity
                CellSnapshot(
                    towerId = id.cid.toString(),
                    lac = id.lac,
                    mcc = id.mccString ?: "",
                    mnc = id.mncString ?: "",
                    generation = "2G",
                    signalStrength = cellInfo.cellSignalStrength.dbm,
                )
            }

            is CellInfoWcdma -> {
                val id = cellInfo.cellIdentity
                CellSnapshot(
                    towerId = id.cid.toString(),
                    lac = id.lac,
                    mcc = id.mccString ?: "",
                    mnc = id.mncString ?: "",
                    generation = "3G",
                    signalStrength = cellInfo.cellSignalStrength.dbm,
                )
            }

            is CellInfoNr -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val id = cellInfo.cellIdentity as? CellIdentityNr
                    if (id != null) {
                        CellSnapshot(
                            towerId = id.nci.toString(),
                            lac = id.tac,
                            mcc = id.mccString ?: "",
                            mnc = id.mncString ?: "",
                            generation = "5G",
                            signalStrength = cellInfo.cellSignalStrength.dbm,
                        )
                    } else {
                        fallbackSnapshot()
                    }
                } else {
                    fallbackSnapshot()
                }
            }

            else -> fallbackSnapshot()
        }
    }

    private fun fallbackSnapshot(): CellSnapshot {
        return CellSnapshot(
            towerId = "",
            lac = 0,
            mcc = "",
            mnc = "",
            generation = networkTypeToGeneration(),
            signalStrength = -100,
        )
    }

    private fun networkTypeToGeneration(): String {
        return when (telephonyManager.dataNetworkType) {
            TelephonyManager.NETWORK_TYPE_GPRS,
            TelephonyManager.NETWORK_TYPE_EDGE,
            TelephonyManager.NETWORK_TYPE_GSM,
            TelephonyManager.NETWORK_TYPE_CDMA,
            TelephonyManager.NETWORK_TYPE_1xRTT,
            TelephonyManager.NETWORK_TYPE_IDEN -> "2G"

            TelephonyManager.NETWORK_TYPE_UMTS,
            TelephonyManager.NETWORK_TYPE_HSDPA,
            TelephonyManager.NETWORK_TYPE_HSUPA,
            TelephonyManager.NETWORK_TYPE_HSPA,
            TelephonyManager.NETWORK_TYPE_EVDO_0,
            TelephonyManager.NETWORK_TYPE_EVDO_A,
            TelephonyManager.NETWORK_TYPE_EVDO_B,
            TelephonyManager.NETWORK_TYPE_EHRPD,
            TelephonyManager.NETWORK_TYPE_HSPAP,
            TelephonyManager.NETWORK_TYPE_TD_SCDMA -> "3G"

            TelephonyManager.NETWORK_TYPE_LTE,
            TelephonyManager.NETWORK_TYPE_IWLAN,
            19 /* LTE_CA */ -> "4G"

            TelephonyManager.NETWORK_TYPE_NR -> "5G"
            else -> "unknown"
        }
    }

    data class CellSnapshot(
        val towerId: String,
        val lac: Int,
        val mcc: String,
        val mnc: String,
        val generation: String,
        val signalStrength: Int,
    )

    companion object {
        private const val DEFAULT_DIAG_LOG_PATH = "/data/local/tmp/protowatch_diag.log"
        private const val DIAG_POLL_INTERVAL_MS = 1000L
    }
}
