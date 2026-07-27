import type { InspectResult } from "./types.js";
export declare function inspectWorkbook(input: string, explicitMapping?: Record<string, string>): Promise<InspectResult>;
export declare function inspectWorkbookBytes(bytes: Buffer, explicitMapping?: Record<string, string>): Promise<InspectResult>;
