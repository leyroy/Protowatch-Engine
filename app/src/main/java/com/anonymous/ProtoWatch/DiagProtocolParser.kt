package com.anonymous.ProtoWatch

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap

object DiagProtocolParser {
    private val towerRegex = Regex("""(?:tower|cell|eci|nci|cid)\s*[:=]\s*([A-Za-z0-9_-]+)""")

    fun parseLine(
        line: String,
        fallbackTowerId: String?,
        timestampMs: Long,
    ): WritableMap? {
        val normalized = line.lowercase()

        val hasNullCipher =
            normalized.contains("eea0") ||
                normalized.contains("null cipher") ||
                normalized.contains("ciphering algorithm: 0") ||
                normalized.contains("nea0")

        val hasAkaBypass =
            normalized.contains("aka_bypass") ||
                normalized.contains("security mode complete missing") ||
                normalized.contains("securitymodecomplete missing") ||
                (normalized.contains("security mode command") && normalized.contains("integrity disabled"))

        val hasImsiRequest =
            normalized.contains("identity request") && normalized.contains("imsi")

        val hasRlfPrivacyLeak =
            normalized.contains("ueinformationrequest") ||
                normalized.contains("ue information request") ||
                normalized.contains("rlf report")

        val forcedDowngrade =
            normalized.contains("downgrade") ||
                (normalized.contains("rrc release") &&
                    (normalized.contains("2g") || normalized.contains("geran") || normalized.contains("gsm")))

        if (!(hasNullCipher || hasAkaBypass || hasImsiRequest || hasRlfPrivacyLeak || forcedDowngrade)) {
            return null
        }

        val parsedTower = towerRegex.find(line)?.groupValues?.getOrNull(1)
        val towerId = parsedTower ?: fallbackTowerId ?: "unknown"

        return Arguments.createMap().apply {
            putString("towerId", towerId)
            putDouble("timestamp", timestampMs.toDouble())
            putString("source", "diag")
            putBoolean("hasNullCipher", hasNullCipher)
            putBoolean("hasAkaBypass", hasAkaBypass)
            putBoolean("hasImsiRequest", hasImsiRequest)
            putBoolean("hasRlfPrivacyLeak", hasRlfPrivacyLeak)
            putBoolean("forcedDowngrade", forcedDowngrade)
        }
    }
}
