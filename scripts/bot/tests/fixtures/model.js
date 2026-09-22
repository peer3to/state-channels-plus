// Recorded provider output boundary, not native CLI or live model evidence.
// The controller, validator and model budget remain the production owners.
class RecordedModelOutput {
    outputs;
    prompts = [];
    beforeTurn;
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
            async () => structuredClone(output),
            async () => {}
        );
    }
}
module.exports = { RecordedModelOutput };
