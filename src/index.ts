// Types
export type {
  CellGeneration,
  CellSnapshot,
  DiagEvidence,
  DiagEvidenceType,
  ThreatType,
  AlertSeverity,
  ThreatAlert,
  SafetyState,
  TowerBaseline,
  MonitorConfig,
} from './types';

// Engine
export { BaselineTracker } from './engine/BaselineTracker';
export { DiagIngestion } from './engine/DiagIngestion';
export { ThreatRules } from './engine/ThreatRules';
export type { RuleMatch } from './engine/ThreatRules';
export { AlertManager } from './engine/AlertManager';
export { ThreatEngine } from './engine/ThreatEngine';
export type { ThreatEngineOptions } from './engine/ThreatEngine';

// Native bridges
export { CellularTelemetryBridge, cellularTelemetryBridge } from './native/CellularTelemetry';
export { DiagLogBridge, diagLogBridge } from './native/DiagLog';

// Monitor
export { PermissionsManager } from './monitor/PermissionsManager';
export type { PermissionStatus, PermissionsResult } from './monitor/PermissionsManager';
export { NotificationService } from './monitor/NotificationService';
export { ProtoWatchMonitor } from './monitor/ProtoWatchMonitor';
export type { SafetyStateListener, AlertListener } from './monitor/ProtoWatchMonitor';
