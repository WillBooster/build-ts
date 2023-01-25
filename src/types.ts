export const allTargetCategories = ['app', 'functions', 'lib'] as const;

export type TargetCategory = (typeof allTargetCategories)[number];

export const allTargetDetails = ['app-node', 'functions', 'lib', 'lib-react'] as const;

export type AllTargetDetails = (typeof allTargetDetails)[number];
