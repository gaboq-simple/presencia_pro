export {
  ClientConfigSchema,
  isMedical,
  isLifestyle,
  type ClientConfig,
  type MedicalConfig,
  type LifestyleConfig,
  type Specialist,
  type MedicalService,
  type LifestyleService,
  type ServiceMode,
  type ServiceIcon,
  type Tone,
  type BotConfig,
  type SchedulingConfig,
  type IntakeConfig,
  type DesignConfig,
  type PostConsultaConfig,
  type Product,
  type ContactConfig,
} from './client.config.schema';

export type { MonthlyMetrics, ServiceCount } from '../dashboard/types';

export type { PatientPortalToken } from '../utils/patientPortalTokens';

export * from './seller';
export * from './seller.schema';

export {
  LifestyleBotStateSchema,
  LifestyleBotContextSchema,
  LifestylePendingSlotSchema,
  AppointmentStatusSchema,
  AppointmentSourceSchema,
  StaffRoleSchema,
  type LifestyleBotState,
  type LifestyleBotContext,
  type LifestyleConversationMessage,
  type LifestylePendingSlot,
  type AppointmentStatus,
  type AppointmentSource,
  type StaffRole,
} from './lifestyle.types';
