function runRecords(input, options = {}) {
    const prefix = "/repos/" + input.repository.name;
    const records = [];
    for (const [workflow, names, id] of [
        ["ci.yml", ["review-bot-tests", "spec", "test", "browser"], 10],
        ["review.yml", ["review-model", "review-publish"], input.run.id]
    ]) {
        const run = {
            id,
            run_attempt: 2,
            head_sha: input.head,
            head_repository: input.repository,
            pull_requests: [{ number: input.pr }]
        };
        records.push({
            path:
                prefix +
                "/actions/workflows/" +
                workflow +
                "/runs?event=pull_request&head_sha=" +
                input.head +
                "&per_page=100&page=1",
            response: { workflow_runs: [run, { ...run, id: id - 1 }] }
        });
        const jobs = names.map((name, index) => ({
            id: id * 100 + index,
            name,
            // GitHub reports retained jobs under the rerun's attempt.
            run_attempt: 2,
            status: "completed",
            conclusion: "success"
        }));
        jobs.push({
            id: id * 100 + 10,
            name: "approve",
            run_attempt: 2,
            status: "in_progress",
            conclusion: null
        });
        if (workflow === "ci.yml" && options.bad)
            jobs[2].conclusion = options.bad;
        if (workflow === "ci.yml" && options.absent) jobs.splice(2, 1);
        records.push({
            path:
                prefix +
                "/actions/runs/" +
                id +
                "/jobs?filter=latest&per_page=100&page=1",
            response: { jobs }
        });
        if (options.bad || options.absent) break;
        if (workflow === "review.yml")
            records.push({
                path:
                    prefix +
                    "/actions/runs/" +
                    id +
                    "/artifacts?per_page=100&page=1",
                response: {
                    artifacts: options.artifacts || [
                        { name: "review-" + id + "-1-result", expired: false }
                    ]
                }
            });
    }
    return records;
}

module.exports = { runRecords };
