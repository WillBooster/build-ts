import type { ArgumentsCamelCase, InferredOptionTypes, Options } from 'yargs';

export const allTargetCategories = ['app', 'functions', 'lib'] as const;

export type TargetCategory = (typeof allTargetCategories)[number];

export const allTargetDetails = ['app-node', 'functions', 'lib', 'lib-react'] as const;

export type TargetDetail = (typeof allTargetDetails)[number];

export type ArgumentsType<T extends Record<string, Options>> = ArgumentsCamelCase<InferredOptionTypes<T>>;
