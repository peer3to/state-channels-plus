const { SourceTools } = require("../../source-tools");
// Records the real owner's outcomes without replacing dispatch or validation.
class ObservedSourceTools extends SourceTools {
    outcomes = [];
    async call(name, input) {
        try {
            const result = await super.call(name, input);
            this.outcomes.push({ name, success: true });
            return result;
        } catch (error) {
            this.outcomes.push({ name, success: false, code: error.code });
            throw error;
        }
    }
}
module.exports = { ObservedSourceTools };
