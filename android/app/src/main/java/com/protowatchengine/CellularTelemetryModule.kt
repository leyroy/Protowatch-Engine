package com.protowatchengine

import android.annotation.SuppressLint
import android.content.Context
import android.os.Build
import android.telephony.*
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Native React Native module that collects live cellular telemetry via
 * Android's [TelephonyManager] and emits structured [CellSnapshot] events
 * to JavaScript.
 *
 * Exposed JavaScript API:
 *   - `CellularTelemetry.startCollection()`
 *   - `CellularTelemetry.stopCollection()`
 *
 * Emitted JavaScript events:
 *   - `onCellSnapshot`   – periodic cell data (see [buildSnapshotMap])
 *   - `onCollectionError` – `{ message: String }`
 */
class CellularTelemetryModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "CellularTelemetry"
        private const val EVENT_SNAPSHOT = "onCellSnapshot"
        private const val EVENT_ERROR = "onCollectionError"
    }

    private val telephonyManager: TelephonyManager by lazy {
        reactContext.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
    }

    private var cellCallback: TelephonyCallback? = null
    // Legacy listener for API < 31
    private var legacyListener: PhoneStateListener? = null
    private var isCollecting = false

    override fun getName(): String = NAME

    // ── React Native API ──────────────────────────────────────────────────

    @ReactMethod
    fun startCollection() {
        if (isCollecting) return
        isCollecting = true

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                registerModernCallback()
            } else {
                registerLegacyListener()
            }
            // Emit the current serving cell immediately
            emitCurrentCell()
        } catch (e: SecurityException) {
            emitError("Permission denied: ${e.message}")
        } catch (e: Exception) {
            emitError("Failed to start collection: ${e.message}")
        }
    }

    @ReactMethod
    fun stopCollection() {
        if (!isCollecting) return
        isCollecting = false

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                cellCallback?.let { telephonyManager.unregisterTelephonyCallback(it) }
                cellCallback = null
            } else {
                @Suppress("DEPRECATION")
                legacyListener?.let { telephonyManager.listen(it, PhoneStateListener.LISTEN_NONE) }
                legacyListener = null
            }
        } catch (_: Exception) {
            /* best-effort cleanup */
        }
    }

    // ── Required for addListener / removeListeners (RN EventEmitter) ──────

    @ReactMethod
    fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) { }

    @ReactMethod
    fun removeListeners(@Suppress("UNUSED_PARAMETER") count: Int) { }

    // ── Modern API (Android 12+) ──────────────────────────────────────────

    @androidx.annotation.RequiresApi(Build.VERSION_CODES.S)
    private fun registerModernCallback() {
        val cb = object : TelephonyCallback(), TelephonyCallback.CellInfoListener {
            override fun onCellInfoChanged(cellInfo: MutableList<CellInfo>) {
                handleCellInfoList(cellInfo)
            }
        }
        cellCallback = cb
        telephonyManager.registerTelephonyCallback(
            reactContext.mainExecutor,
            cb,
        )
    }

    // ── Legacy API (Android < 12) ─────────────────────────────────────────

    @Suppress("DEPRECATION")
    private fun registerLegacyListener() {
        val listener = object : PhoneStateListener() {
            @Deprecated("Deprecated in Java")
            override fun onCellInfoChanged(cellInfo: MutableList<CellInfo>?) {
                cellInfo?.let { handleCellInfoList(it) }
            }
        }
        legacyListener = listener
        telephonyManager.listen(listener, PhoneStateListener.LISTEN_CELL_INFO)
    }

    // ── Cell processing ───────────────────────────────────────────────────

    @SuppressLint("MissingPermission")
    private fun emitCurrentCell() {
        try {
            val cells = telephonyManager.allCellInfo ?: return
            handleCellInfoList(cells)
        } catch (_: SecurityException) {
            /* permission may have been revoked after startCollection */
        }
    }

    private fun handleCellInfoList(cells: List<CellInfo>) {
        // Prefer the registered / serving cell
        val serving = cells.firstOrNull { it.isRegistered } ?: cells.firstOrNull() ?: return
        val map = buildSnapshotMap(serving) ?: return
        emitEvent(EVENT_SNAPSHOT, map)
    }

    /**
     * Convert a [CellInfo] subclass to a [WritableMap] matching the
     * TypeScript [CellSnapshot] interface.
     */
    private fun buildSnapshotMap(cell: CellInfo): WritableMap? {
        val map = Arguments.createMap()
        map.putDouble("timestamp", System.currentTimeMillis().toDouble())

        return when (cell) {
            is CellInfoGsm -> {
                val id = cell.cellIdentity
                val sig = cell.cellSignalStrength
                map.putString("generation", "2G")
                map.putString("cellId", id.cid.toString())
                map.putString("mcc", id.mccString ?: "")
                map.putString("mnc", id.mncString ?: "")
                map.putInt("lac", id.lac)
                map.putInt("arfcn", id.arfcn)
                map.putDouble("signalStrength", sig.dbm.toDouble())
                map
            }
            is CellInfoWcdma -> {
                val id = cell.cellIdentity
                val sig = cell.cellSignalStrength
                map.putString("generation", "3G")
                map.putString("cellId", id.cid.toString())
                map.putString("mcc", id.mccString ?: "")
                map.putString("mnc", id.mncString ?: "")
                map.putInt("lac", id.lac)
                map.putInt("arfcn", id.uarfcn)
                map.putDouble("signalStrength", sig.dbm.toDouble())
                map
            }
            is CellInfoLte -> {
                val id = cell.cellIdentity
                val sig = cell.cellSignalStrength
                map.putString("generation", "4G")
                map.putString("cellId", id.ci.toString())
                map.putString("mcc", id.mccString ?: "")
                map.putString("mnc", id.mncString ?: "")
                map.putInt("tac", id.tac)
                map.putInt("pci", id.pci)
                map.putInt("arfcn", id.earfcn)
                map.putDouble("signalStrength", sig.dbm.toDouble())
                map
            }
            is CellInfoNr -> {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
                val id = cell.cellIdentity as CellIdentityNr
                val sig = cell.cellSignalStrength as CellSignalStrengthNr
                map.putString("generation", "5G")
                map.putString("cellId", id.nci.toString())
                map.putString("mcc", id.mccString ?: "")
                map.putString("mnc", id.mncString ?: "")
                map.putInt("tac", id.tac)
                map.putInt("pci", id.pci)
                map.putInt("arfcn", id.nrarfcn)
                map.putDouble("signalStrength", sig.dbm.toDouble())
                map
            }
            else -> null
        }
    }

    // ── Event helpers ─────────────────────────────────────────────────────

    private fun emitEvent(name: String, payload: WritableMap) {
        if (!reactContext.hasActiveCatalystInstance()) return
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit(name, payload)
    }

    private fun emitError(message: String) {
        val map = Arguments.createMap()
        map.putString("message", message)
        emitEvent(EVENT_ERROR, map)
    }
}
