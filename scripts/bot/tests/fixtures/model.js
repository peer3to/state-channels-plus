// Recorded provider output boundary, not native CLI or live model evidence.
// The controller, validator and model budget remain the production owners.
class RecordedModelOutput {
    outputs;
    // The CLI runtime an adapter reports after open().
    runtime = "codex-0.156.1";
    prompts = [];
    beforeTurn;
    turnMs = 0;
    constructor(outputs, beforeTurn = async () => {}) {
        this.outputs = [...outputs];
        this.beforeTurn = beforeTurn;
    }
    async turn(prompt, budget) {
        await this.beforeTurn();
        this.prompts.push(prompt);
        if (!this.outputs.length)
            throw new Error("Unexpected extra model turn");
        const output = this.outputs.shift();
        return budget.run(
            async () => {
                if (this.turnMs)
                    await new Promise((resolve) =>
                        setTimeout(resolve, this.turnMs)
                    );
                return structuredClone(output);
            },
            async () => {}
        );
    }
}
module.exports = { RecordedModelOutput };
