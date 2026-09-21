// Recorded provider output boundary, not native CLI or live model evidence.
// The controller, validator and model budget remain the production owners.
class RecordedModelOutput {
    outputs;
    prompts = [];
    constructor(outputs) {
        this.outputs = [...outputs];
    }
    async turn(prompt, budget) {
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
