class ResourceAllocationError extends Error {
    constructor(resource, requested, permitted) {
        super(
            `Requested ${resource} (${requested}) exceeds the permitted allocation (${permitted})`
        );
        this.name = "ResourceAllocationError";
        this.code = "RESOURCE_ALLOCATION_REJECTED";
        this.resource = resource;
        this.requested = requested;
        this.permitted = permitted;
    }
}

const PROFILE_FIELDS = {
    schedulerTickMs: { integer: true, minimum: 1 },
    workers: { integer: true, minimum: 1 },
    slots: { integer: true, minimum: 0 },
    cpu: { minimum: 0.01 },
    memoryBytes: { integer: true, minimum: 1 },
    diskBytes: { integer: true, minimum: 1 },
    pidsLimit: { integer: true, minimum: 1 },
    targetLoad: { minimum: 0.01 }
};

function validateProfileValue(field, value) {
    const rules = PROFILE_FIELDS[field];
    if (
        !rules ||
        !Number.isFinite(value) ||
        value < rules.minimum ||
        (rules.integer && !Number.isInteger(value))
    ) {
        throw new Error(`Invalid execution profile value for ${field}`);
    }
}

function resolveExecutionProfile(defaults, ceilings, requested = {}) {
    const unknown = Object.keys(requested).filter(
        (field) => !Object.hasOwn(PROFILE_FIELDS, field)
    );
    if (unknown.length) {
        throw new Error(`Unknown execution profile field: ${unknown[0]}`);
    }
    const resolved = {};
    for (const field of Object.keys(PROFILE_FIELDS)) {
        const fallback = defaults[field];
        const ceiling = ceilings[field];
        validateProfileValue(field, fallback);
        validateProfileValue(field, ceiling);
        const value = requested[field] ?? fallback;
        validateProfileValue(field, value);
        if (value > ceiling) {
            throw new ResourceAllocationError(field, value, ceiling);
        }
        resolved[field] = value;
    }
    return Object.freeze(resolved);
}

function profileSummary(profile) {
    return Object.fromEntries(
        Object.keys(PROFILE_FIELDS).map((field) => [field, profile[field]])
    );
}

module.exports = {
    PROFILE_FIELDS,
    ResourceAllocationError,
    profileSummary,
    resolveExecutionProfile
};
