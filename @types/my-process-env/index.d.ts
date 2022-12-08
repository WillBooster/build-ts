declare namespace NodeJS {
  export interface ProcessEnv {
    BLITZ_PUBLIC_ENVIRONMENT?: 'staging' | 'wb' | 'production';
    ENABLE_VOTE?: string;
    REPAIR_AI_API_URL?: string;
    SENDGRID_API_KEY: string;
  }
}
