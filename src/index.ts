import { restoreCache, saveCache, isFeatureAvailable } from "@actions/cache";
import { getInput, setOutput, debug } from "@actions/core";
import path from "path";
import fs from "fs";
import Variable from "./Variable.js";
import spawnChildProcess from "./spawnChildProcess.js";

const trimBrackets = (str: string) => str.replace(/^\{(.*)\}$/, "$1");

if (!isFeatureAvailable()) {
    throw new Error("Cache feature is not available.");
}

console.info("Parsing input...");
const inputs = {
    cacheKey: getInput("cacheKey"),
    customVariable: getInput("customVariable"),
    command: getInput("command"),
    cwd: getInput("cwd"),
    lockfilePath: getInput("lockfilePath"),
};

debug(`inputs: ${JSON.stringify(inputs)}`);

const lockfilePath = path.join(inputs.cwd, inputs.lockfilePath);
const nodeModulesPath = path.join(inputs.cwd, "node_modules");
console.info("lockfilePath:", lockfilePath);
console.info("nodeModulesPath:", nodeModulesPath);

try {
    console.info("Testing if the lockfile can be read...");
    await fs.promises.access(lockfilePath, fs.constants.R_OK);
} catch (cause) {
    throw new Error(`Lockfile "${lockfilePath}" does not exist.`, {
        cause,
    });
}

const variable = new Variable(inputs.lockfilePath, inputs.customVariable);

console.info("Replacing variables...");
const variableNames = [...new Set(inputs.cacheKey.match(/\{([A-Z_\d]+)\}/g))];
debug(`[replacingVariables] matched variableNames (after removing duplicate variables): ${JSON.stringify(variableNames)}`);
let cacheKey = inputs.cacheKey;
debug(`[replacingVariables] [start] cacheKey: ${cacheKey}`);
for (const variableName of variableNames) {
    debug(`[replacingVariables] \tRun on variableName: ${variableName}`);
    const trimmedVariableName = trimBrackets(variableName);
    debug(`[replacingVariables] \t\ttrimmedVariableName: ${trimmedVariableName}`);
    if (trimmedVariableName === "CUSTOM_VARIABLE" || Reflect.has(Variable.VARIABLE_MAP, trimmedVariableName)) {
        debug(`[replacingVariables] \t\tVariable "${trimmedVariableName}" is in the list.`);
        const variableValue = await variable.get(trimmedVariableName as "CUSTOM_VARIABLE" | keyof typeof Variable.VARIABLE_MAP);
        debug(`[replacingVariables] \t\tvariableValue: ${variableValue}`);
        cacheKey = cacheKey.replaceAll(variableName, variableValue);
        debug(`[replacingVariables] \t\tnew cacheKey: ${cacheKey}`);
    }
}
debug(`[replacingVariables] [after] cacheKey: ${cacheKey}`);
console.info("cacheKey:", cacheKey);

console.info("Start to restore cache...");
const restoreCacheResult = await restoreCache([nodeModulesPath], cacheKey, undefined, {
    timeoutInMs: 1000 * 60 * 5,
    segmentTimeoutInMs: 1000 * 60 * 5,
}, false);
debug(`restoreCacheResult: ${restoreCacheResult}`);

if (restoreCacheResult) {
    console.info("Cache exists and restored.");
} else {
    console.info("Cache does not exist, start to run command...");
    await spawnChildProcess(inputs.command, {
        synchronousStdout: true,
        synchronousStderr: true,
    });
    console.info("Command finished, start to save cache...");
    const saveCacheResult = await saveCache([nodeModulesPath], cacheKey, {
        uploadConcurrency: 8,
    }, false);
    debug(`saveCacheResult: ${saveCacheResult}`);
    console.info("Cache saved.");
}

debug("Setting outputs...");
setOutput("cacheKey", cacheKey);
setOutput("variables", variable.getCache());
debug("Outputs set, exit.");
