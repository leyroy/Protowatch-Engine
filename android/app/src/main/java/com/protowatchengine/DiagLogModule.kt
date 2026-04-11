package com.protowatchengine

import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.BufferedReader
import java.io.FileReader
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.Future

/**
 * Native React Native module for DIAG log ingestion.
 *
 * Reads Qualcomm DIAG-style log lines from `/dev/diag` (or a path supplied
 * via [startIngestion]), parses them for security-relevant events, and
 * emits structured [DiagEvidence] objects to JavaScript.
 *
 * Exposed JavaScript API:
 *   - `DiagLog.startIngestion(path?: String)`
 *   - `DiagLog.stopIngestion()`
 *
 * Emitted JavaScript events:
 *   - `onDiagEvidence` – parsed evidence (see [parseLine])
 *   - `onDiagError`    – `{ message: String }`
 *
 * Note: Access to `/dev/diag` requires a privileged system process or
 * a device with unlocked DIAG access.  On standard user-builds this module
 * is expected to emit a permission error and the JS layer will continue
 * operating without protocol-level evidence.
 */
class DiagLogModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "DiagLog"
        private const val DEFAULT_DIAG_PATH = "/dev/diag"
        private const val EVENT_EVIDENCE = "onDiagEvidence"
        private const val EVENT_ERROR = "onDiagError"
    }

    private val executor = Executors.newSingleThreadExecutor()
    private var ingestionFuture: Future<*>? = null
    @Volatile private var running = false

    override fun getName(): String = NAME

    // ── React Native API ──────────────────────────────────────────────────

    @ReactMethod
    fun startIngestion(path: String?) {
        if (running) return
        running = true
        val diagPath = if (path.isNullOrBlank()) DEFAULT_DIAG_PATH else path

        ingestionFuture = executor.submit {
            try {
                BufferedReader(FileReader(diagPath)).use { reader ->
                    var line: String?
                    while (running) {
                        line = reader.readLine()
                        if (line != null) {
                            parseLine(line)?.let { emitEvidence(it) }
                        } else {
                            // Wait for more data
                            Thread.sleep(200)
                        }
                    }
                }
            } catch (e: SecurityException) {
                emitError("Permission denied reading DIAG: ${e.message}")
            } catch (e: IOException) {
                emitError("DIAG read error: ${e.message}")
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            }
        }
    }

    @ReactMethod
    fun stopIngestion() {
        running = false
        ingestionFuture?.cancel(true)
        ingestionFuture = null
    }

    // Required for RN EventEmitter
    @ReactMethod
    fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) { }

    @ReactMethod
    fun removeListeners(@Suppress("UNUSED_PARAMETER") count: Int) { }

    // ── DIAG parsing ──────────────────────────────────────────────────────

    /**
     * Parse a single DIAG log line and return a [WritableMap] matching the
     * TypeScript [DiagEvidence] interface, or null if the line is not
     * security-relevant.
     *
     * Expected line format (simplified, space-delimited):
     *   `<timestamp_ms> <EVENT_TYPE> [key=value ...]`
     *
     * Supported event types:
     *   - `AKA_BYPASS`
     *   - `IMSI_EXPOSURE`
     *   - `NULL_CIPHER`
     *   - `DOWNGRADE`
     *   - `PRIVACY_LEAK`
     *   - `ROGUE_TOWER`
     */
    private fun parseLine(line: String): WritableMap? {
        val trimmed = line.trim()
        if (trimmed.isEmpty() || trimmed.startsWith("#")) return null

        val parts = trimmed.split("\\s+".toRegex(), limit = 3)
        if (parts.size < 2) return null

        val timestampMs = parts[0].toLongOrNull() ?: System.currentTimeMillis()
        val eventType = parts[1].uppercase()

        val knownTypes = setOf(
            "AKA_BYPASS", "IMSI_EXPOSURE", "NULL_CIPHER",
            "DOWNGRADE", "PRIVACY_LEAK", "ROGUE_TOWER",
        )
        if (eventType !in knownTypes) return null

        val details = Arguments.createMap()
        if (parts.size > 2) {
            // Parse key=value pairs from the remainder
            parts[2].split("\\s+".toRegex()).forEach { kv ->
                val eqIdx = kv.indexOf('=')
                if (eqIdx > 0) {
                    details.putString(kv.substring(0, eqIdx), kv.substring(eqIdx + 1))
                }
            }
        }

        val map = Arguments.createMap()
        map.putString("type", eventType)
        map.putDouble("timestamp", timestampMs.toDouble())
        map.putMap("details", details)
        return map
    }

    // ── Event helpers ─────────────────────────────────────────────────────

    private fun emitEvidence(payload: WritableMap) {
        emitEvent(EVENT_EVIDENCE, payload)
    }

    private fun emitError(message: String) {
        val map = Arguments.createMap()
        map.putString("message", message)
        emitEvent(EVENT_ERROR, map)
    }

    private fun emitEvent(name: String, payload: WritableMap) {
        if (!reactContext.hasActiveCatalystInstance()) return
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit(name, payload)
    }
}
