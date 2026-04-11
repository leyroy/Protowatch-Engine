# ProtoWatch Android Engine

This folder contains the native Android runtime for ProtoWatch and the bridge that feeds cellular telemetry into the React Native detection pipeline.

## What The Android Engine Does

- Collects live serving-cell data from Android telephony APIs.
- Emits normalized updates to React Native over the native event bridge.
- Ingests optional DIAG log lines and emits protocol-evidence events.
- Keeps monitoring resilient by continuing through transient read/parse errors.

## Architecture

### 1) Native collector (Kotlin)

The native module is implemented in `app/src/main/java/com/anonymous/ProtoWatch/CellMonitorModule.kt`.

It exposes methods to JavaScript:

- `startMonitoring()`
- `stopMonitoring()`
- `startDiagIngestion()`
- `stopDiagIngestion()`
- `setDiagLogPath(path)`
- `ingestDiagLine(line, towerId, timestampMs)`

Core behavior:

- Registers a `PhoneStateListener` for signal strength and cell info.
- Maps registered cell info into a normalized snapshot:
  - `towerId`
  - `lac`/`tac`
  - `mcc` / `mnc`
  - generation (`2G`, `3G`, `4G`, `5G`)
  - signal strength (`dBm`)
- Produces event payload flags for threat hints and protocol evidence.

### 2) Native event bridge

The module sends two event streams to JavaScript:

- `onSignalUpdate`: live radio snapshot + heuristic flags.
- `onProtocolEvidence`: DIAG-derived or heuristic protocol evidence.

### 3) DIAG ingestion

DIAG ingestion is polled on a scheduled executor (default 1s) from:

- `/data/local/tmp/protowatch_diag.log` (default)

Each parsed line can produce protocol evidence and is emitted as `onProtocolEvidence`.

## End-To-End Detection Flow

1. Android native module emits `onSignalUpdate` and `onProtocolEvidence`.
2. React Native hook `hooks/useNetworkMonitor.ts` subscribes to both events.
3. Protocol evidence is normalized and merged with live signal updates.
4. `BaselineProfiler` learns normal tower behavior over time.
5. `ThreatRuleEngine` evaluates rules:
   - AKA bypass
   - IMSI request exposure
   - null cipher
   - forced/abnormal downgrade
   - RLF privacy leak
   - suspicious new tower with signal anomaly
6. `AlertDispatcher` deduplicates and materializes alerts.
7. App UI updates monitor status and alerts in real time.

## Permissions

Native monitoring requires:

- `READ_PHONE_STATE`
- `ACCESS_FINE_LOCATION`

If permissions are denied, the app falls back to simulator mode on the JS side.

## Build Notes

For local APK builds:

```powershell
cd android
.\gradlew.bat assembleRelease --console=plain --no-daemon -PreactNativeArchitectures=arm64-v8a
```

Release APK output:

- `app/build/outputs/apk/release/app-release.apk`

## Operational Notes

- The engine is designed for continuous monitoring, not one-shot scans.
- Event-level heuristics are lightweight; baseline + rules provide the stronger signal.
- DIAG evidence is merged with TTL logic in JavaScript to avoid stale protocol flags.
