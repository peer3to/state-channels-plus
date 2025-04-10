import { ValidationResult } from "./types";
import { ExecutionFlags } from "@/DataTypes";

export async function runPipeline<
    TContext,
    TStep extends (context: TContext) => Promise<ValidationResult>
>(steps: TStep[], context: TContext): Promise<ValidationResult> {
    for (const step of steps) {
        const result = await step(context);
        if (result.executionFlag !== ExecutionFlags.SUCCESS) {
            return result; // Stop on first non-SUCCESS
        }
    }
    return { executionFlag: ExecutionFlags.SUCCESS };
}
