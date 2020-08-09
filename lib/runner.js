'use strict';

const TruffleContract = require('@truffle/contract');
const Promise = require('bluebird');
const chalk = require('chalk');
const merge = require('deepmerge');
const fs = require('fs');
const objectMapper = require('object-mapper');
const ora = require('ora');
const path = require('path');
const TruffleObjectMapper = require('truffle-object-mapper');
const util = require('util');
const winston = require('winston');

const Command = require('./command');
const CommandLoop = require('./command-loop');
const AbiReader = require('./abi-reader');
const ScriptReader = require('./script-reader');
const ProviderAware = require('./provider-aware');
const CommandResultTransport = require('./logger-command-result-transport');

const workingDirectoryDefault = path.join(__dirname, '/../../../');

const defaults = {
  closeOnFinish: true,
  debug: false,
  debugInspectDepth: 5,
  dump: false,
  dumpFilename: null,
  dumpMap: null,
  logger: null,
  mapper: {},
  mapping: 'mapping.js',
  networkName: 'development',
  resultDir: null,
  spinner: true,
  scriptDirectory: 'playbooks',
  workingDirectory: workingDirectoryDefault,
};

const wait = time => new Promise((resolve) => {
  setTimeout(resolve, time);
});

class Runner extends ProviderAware {
  constructor(options = {}) {
    const opts = merge(defaults, options);
    super(opts);
    this.options = opts;
    this.abiReader = new AbiReader(this.options);
    this.scriptReader = new ScriptReader(this.options);
    this.methodArtifacts = {};

    const networkInfo = this.truffleConfig.networks[this.truffleConfig.network];
    this.commandResultTransport = new CommandResultTransport({
      level: 'debug',
      network: networkInfo.network_id,
      resultDir: this.options.resultDir || path.join(this.options.workingDirectory, 'results'),
    });
    this.commandLogger = winston.createLogger({
      levels: {
        fail: 0,
        succeed: 1,
        debug: 2,
      },
      transports: [this.commandResultTransport],
    });

    if (this.options.dumpFilename) {
      if (!path.isAbsolute(this.options.dumpFilename) &&
        this.options.workingDirectory &&
        this.options.dump) {
        this.options.dumpFilename = path.join(this.options.workingDirectory, this.options.dumpFilename);
      }
    } else {
      this.options.dumpFilename = this.commandResultTransport.buildFilename('json', 'state');
    }

    if (this.options.mapping) {
      if ('string' === typeof this.options.mapping || Array.isArray(this.options.mapping)) {
        // load mapping from file
        const loadedMappingFromFiles = this.scriptReader.merge(this.options.mapping);
        const { mapping, types } = loadedMappingFromFiles;
        this.mapperOptions = merge(this.options, {
          mapping,
          types,
        });
      } else {
        // mapping specified as object
        const { mapping, types } = this.options;
        this.mapperOptions = merge.all([
          this.options,
          {
            mapping,
            types,
          },
        ]);
      }
    } else {
      this.mapperOptions = {};
    }
    this.mapper = new TruffleObjectMapper(this.mapperOptions);
    this.initOraCompatibleLogger();
  }

  async execUtil(method, contractName, at, inputs) {
    method = method.replace('util.', '');
    if (!this[method]) {
      throw new Error(`No ${method} exists.`);
    }
    inputs.unshift(contractName, at);
    return await this[method].apply(this, inputs);
  }

  async map(contractName, at) {
    return await this.mapper.map(contractName, at);
  }

  async contractAt(contractName, at) {
    const Contract = this.getContract(contractName);
    return await Contract.at(at);
  }

  getCommandEmoji(command) {
    switch (command.run) {
      case 'new':
        return '📦';
      case 'link':
        return '🔗';
      default:
        return '🧾';
    }
  }

  getTransactionHash(output) {
    if (!output) {
      return undefined;
    }
    if (output.tx) {
      return output.tx;
    }
    if (output.transactionHash) {
      return output.transactionHash;
    }
    if (output.receipt && output.receipt.transactionHash) {
      return output.receipt.transactionHash;
    }
    return undefined;
  }

  getCommandSummary(command) {
    if (command.contract && command.run) {
      return 0 === command.run.indexOf('util.') ?
        `${command.run}(${command.contract}, ${command.at})` :
        `${command.contract}.${command.run}`;
    }
    if (command.for && command.each) {
      return `for each "${command.for}" run ${command.each.length} commands`;
    }
    return '???';
  }

  getCommandMessage(command, decoration = true) {
    const emoji = decoration ? this.getCommandEmoji(command) : '';
    const spacing = decoration ? '\t' : '';
    const summary = decoration ? `${chalk.magenta(this.getCommandSummary(command))}` :
      this.getCommandSummary(command);
    return command.description ?
      `${emoji}${spacing}${command.description} [${summary}]` :
      `${emoji}${spacing}${summary}`;
  }

  async read(globPathsAndScripts, state = {}) {
    // try to reasonable merge $inputs and $deployed
    if ('object' !== typeof state.$inputs) {
      if ('object' !== typeof state.$deployed) {
        state = merge(state, {
          $inputs: state,
          $deployed: {},
        });
      } else {
        state = merge(state, {
          $inputs: state,
          $deployed: state.$deployed,
        });
      }
    }
    // expecting an array, but a single script will do okay
    if (!Array.isArray(globPathsAndScripts)) {
      globPathsAndScripts = [globPathsAndScripts];
    }

    // may be a mix of inline and file paths
    let scripts = [];
    globPathsAndScripts.forEach((pathOrScript) => {
      if ('string' === typeof pathOrScript) {
        const newScripts = this.scriptReader.read(pathOrScript);
        scripts = scripts.concat(newScripts);
      } else if (Array.isArray(pathOrScript)) {
        pathOrScript.filename = `${pathOrScript.length} inline scripts`;
        scripts.push(pathOrScript);
      } else if ('object' === typeof pathOrScript) {
        const wrapped = [pathOrScript];
        const commandMessage = this.getCommandMessage(pathOrScript, false);
        wrapped.filename = `Inline script: ${commandMessage}`;
        scripts.push(wrapped);
      } else {
        throw new TypeError(`Unexpected item: should be path or script "${pathOrScript}"`);
      }
    });

    const scriptFiles = scripts.map((script, i) => `${i + 1}. ${chalk.yellow(script.filename)}`);
    const planMessagePrefix = `Will run ${scripts.length} playbooks:`;
    this.spinner.stopAndPersist({
      symbol: '📚',
      text: `${chalk.blueBright(planMessagePrefix)}\n\t${scriptFiles.join('\n\t')}`,
    });
    const results = [];
    await Promise.each(scripts, async (commands) => {
      try {
        this.spinner.stopAndPersist({
          symbol: '▶️ ',
          text: `${chalk.blueBright('Running:')}\t${chalk.yellow(commands.filename)}`,
        });
        this.spinner.start(`▶️ ${chalk.blueBright('Running:')}\t${chalk.yellow(commands.filename)}...`);
        this.commandLogger.debug(`--- Begin ${commands.filename} ---`);
        const result = await this.run(commands, state);
        results.push(result);
        this.spinner.stopAndPersist({
          symbol: '✅',
          text: `${chalk.greenBright('Ran OK:')}\t${chalk.yellow(commands.filename)}`,
        });
        this.commandLogger.debug(`--- End ${commands.filename} ---`);
      } catch (err) {
        this.spinner.fail(`${chalk.redBright('FAILED:')}'\t${chalk.yellow(commands.filename)}\n\t\t${err} ---\n${err.stack || ''}${err.hijackedStack || ''}`);
        this.commandLogger.debug(`--- End ${commands.filename} ---`);
        return Promise.reject(err);
      }
    }, { concurrency: 1 });
    this.spinner.stopAndPersist({
      symbol: '📝',
      text: `Results:\t${chalk.yellow(this.commandResultTransport.filename)}`,
    });
    if (this.options.dump) {
      this.spinner.start(`📝 State: '${chalk.yellow(this.options.dumpFilename)}'`);
      let output;
      if (Array.isArray(this.options.dumpPath)) {
        output = {};
        this.options.dumpPath.forEach((path) => {
          const val = objectMapper.getKeyValue(state, path);
          objectMapper.setKeyValue(output, path, val);
        });
      } else {
        output = state;
      }
      const serialized = JSON.stringify(output, null, 2);
      fs.writeFileSync(this.options.dumpFilename, serialized, 'utf8');
      this.spinner.stopAndPersist({
        symbol: '📝',
        text: `State:\t${chalk.yellow(this.options.dumpFilename)}`,
      });
    }
    this.spinner.stopAndPersist({
      symbol: '🏁',
      text: 'Finished OK.',
    });
    return results;
  }

  async run(command, state) {
    state.commandIndex = state.commandIndex ? state.commandIndex : 1;

    if (Array.isArray(command)) {
      state.commandCount = Runner.getCommandCount(command, state);
      state.commandIndex = 1;
      try {
        const results = [];
        await Promise.each(command, async (individualCommand, i) => {
          const result = await this.run(individualCommand, state);
          results[i] = result;
          await wait(this.options.delay);
          return result;
        });

        this.closeOnFinish();
        this.spinner.prefixText = '';
        return results;
      } catch (err) {
        this.closeOnFinish();
        return Promise.reject(err);
      }
    }

    try {
      // just in case some items are not defined
      this.initState(state);

      this.spinner.prefixText = `${state.commandIndex} of ${state.commandCount}`;

      if (!(command instanceof Command)) {
        if (CommandLoop.isCommandLoop(command)) {
          const commandLoop = new CommandLoop(command);
          const commands = commandLoop.commands(state);
          return Promise.each(commands, async command => await this.run(command, state));
        } else if (Command.isFilePlaybook(command)) {
          const playbooks = this.scriptReader.read(command.playbook);
          if (command.inputs) {
            state.$inputs = merge(state.$inputs, command.inputs);
          }
          const commands = [];
          playbooks.forEach((playbook) => {
            playbook.forEach((playbookCommand) => {
              commands.push(playbookCommand);
            });
          });
          return Promise.each(commands, async command => await this.run(command, state));
        } else {
          command = new Command(command);
        }
      }

      this.spinner.start(this.getCommandMessage(command, false));

      let target;
      if (command.isStatic) {
        const Contract = this.getContract(command.contract, state);
        target = Contract;
      } else {
        command.at = Command.applyRegexToInput(command.at, state);
        target = await this.contractAt(command.contract, command.at);
      }
      const inputs = command.getInputs(state);

      // constructor and other arguments can be "named" arguments
      // and the ABI will be used to figure out the correct order
      let sortedInputs = inputs;
      let artifact;
      if (inputs.length && ('new' === command.run || !command.isStatic)) {
        artifact = this.getArtifactForMethod(command.contract, command.run);
        if (artifact) {
          sortedInputs = command.sortInputsUsingAbi(inputs, artifact);
        }
      }

      // special case needed for linking
      if ('link' === command.run) {
        await target.detectNetwork();
      }

      if (this.options.debug) {
        this.spinner.info(`Inputs: ${util.inspect(sortedInputs, {
          depth: this.options.debugInspectDepth,
        })}`);
      }

      // execute the method and capture output
      const activeHandlesBefore = process._getActiveHandles();
      let output;
      if (0 === command.run.indexOf('util.')) {
        output = await this.execUtil(command.run, command.contract, command.at, inputs);
      } else {
        const method = target[command.run];
        if (!method) {
          throw new TypeError(`No method ${command.run} found on contract ${command.contract}`);
        }
        // actually call the method
        output = await method.apply(target, sortedInputs);
        // //
        // apply mapping transformation to output
        // //
        try {
          artifact = artifact || this.getArtifactForMethod(command.contract, command.run);
        } catch (err) {
          // ignore missing artifact
        }
        if (artifact) {
          // determine output type as mentioned in ABI
          const type = command.getOutputTypeFromAbi(artifact);
          // look up mapping rule, which could be:
          // - method name specific, e.g. balanceOf (only the balanceOf method)
          // - type specifc, e.g. uint64 (only 64 byte unsigned integers)
          // - general type rule using alias, e.g. uint (all unsigned integers)
          const outputMapping = this.mapper.buildOutputMapping(command.run, type);
          if ('object' === typeof outputMapping) {
            let transform;
            if (Array.isArray(outputMapping)) {
              const [mapping] = outputMapping;
              transform = mapping.transform;
            } else {
              transform = outputMapping.transform;
            }
            if (transform) {
              output = transform(output);
            }
          }
        }
      }
      const activeHandlesAfter = process._getActiveHandles();
      this.removeDanglingHandles(activeHandlesBefore, activeHandlesAfter);

      if (this.options.debug) {
        this.spinner.info(`Outputs: ${util.inspect(output, {
          depth: this.options.debugInspectDepth,
        })}`);
      }

      const commandMessage = this.getCommandMessage(command);
      const transactionHash = this.getTransactionHash(output);
      const address = output ? output.address : undefined;

      const result = {
        address,
        command,
        output,
        transactionHash,
      };

      // truffle gives no full transaction info for deploying new contracts
      // so we'll manually look it up so caller can use it, as needed
      if ('new' === command.run) {
        const web3 = this.getWeb3();
        result.output.transaction = await web3.eth.getTransaction(result.transactionHash);
      }

      command.writeOutputs(result, state);

      // if simple string was specified
      // add that path to the state dump
      // since they likely care about it
      if ('string' === typeof command.outputs &&
        -1 === this.options.dumpPath.indexOf(command.outputs)) {
        this.options.dumpPath.push(command.outputs);
      }

      let message;
      if ('new' === command.run) {
        // truffle's inner magic manually adds address and transactionHash
        // to the instance of the contract abstraction after deployed via Contract.new()
        // so this hack is required to cover for truffle's magic special sauce
        // under the hood of the 'deployer' object in
        // https://github.com/trufflesuite/truffle/blob/develop/packages/deployer/src/deployment.js
        target.address = result.address;
        target.transactionHash = result.transactionHash;
        message = `${commandMessage} at ${chalk.green(result.address)}\n\t\t(transaction: ${chalk.cyan(result.transactionHash)}, blockNumber: ${chalk.cyan(result.output.transaction.blockNumber)})`;
      } else if (result.transactionHash) {
        message = `${commandMessage}\n\t\t(transaction: ${chalk.cyan(result.transactionHash)})`;
      } else {
        message = `${commandMessage}`;
      }

      this.commandLogger.succeed(message, result);
      this.spinner.succeed(message);
      this.spinner.start();
      state.commandIndex++;

      return output;
    } catch (error) {
      const message = this.getCommandMessage(command);
      this.spinner.fail(`${message} FAILED\n\t\t${error}`);
      this.commandLogger.fail(message, {
        command,
        error,
      });
      return Promise.reject(error);
    }
  }

  closeOnFinish() {
    if (this.options.closeOnFinish) {
      // close underlying provider, if applicable
      this.close();
    }
  }

  getContract(contractName, state = {}) {
    if (state.$contracts && state.$contracts[contractName]) {
      return state.$contracts[contractName];
    }
    const artifact = this.abiReader.getArtifact(contractName);
    const Contract = TruffleContract(artifact);
    Contract.setProvider(this.getProvider(this.options));
    state.$contracts = state.$contracts || {};
    state.$contracts[contractName] = Contract;
    return Contract;
  }

  getArtifactForMethod(contractName, methodName) {
    this.methodArtifacts[contractName] = this.methodArtifacts[contractName] || {};
    if (this.methodArtifacts[contractName][methodName]) {
      return this.methodArtifacts[contractName][methodName];
    }

    const artifact = this.abiReader.getArtifact(contractName);
    if (!artifact) {
      throw new Error(`No arifact found for ${contractName}`);
    }

    for (let i = 0; i < artifact.abi.length; i++) {
      const method = artifact.abi[i];
      if (methodName === method.name || ('new' === methodName && 'constructor' === method.type)) {
        this.methodArtifacts[contractName][methodName] = method;
        return this.methodArtifacts[contractName][methodName];
      }
    }

    if (-1 === Command.noArtifactMethods.indexOf(methodName)) {
      throw new Error(`No arifact found for ${contractName}.${methodName}`);
    }

    return false;
  }

  initState(state = {}) {
    state.$inputs = state.$inputs || {};
    state.$outputs = state.$outputs || {};
    state.$contracts = state.$contracts || {};
    state.$deployed = state.$deployed || {};
  }

  removeDanglingHandles(before, after) {
    if (after.length <= before.length) {
      return;
    }
    after.forEach((handle) => {
      if (-1 !== before.indexOf(handle)) {
        // existing handle before method, ignore
        return;
      }
      if (handle.removeAllListeners) {
        // dangling event listener
        handle.removeAllListeners();
      }
      if (handle.unref) {
        // dangling timer
        handle.unref();
      }
    });
  }

  initOraCompatibleLogger(message = '') {
    // default: use ora to communicate status with spinner
    if (this.options.spinner) {
      this.spinner = this.spinner || ora();
      this.spinner.start(message);
      return this.spinner;
    }

    // spinner disabled but logger enabled or provided; create a logger, using supplied methods if available
    if (this.options.logger) {
      this.spinner = { prefixText: '' };

      const bindMethod = (fn, fallback) => fn ? fn.bind(this.spinner) : fallback.bind(this.spinner);

      this.spinner.info = bindMethod(this.options.logger.debug, function (message) {
        /* eslint no-console: 0 */
        return console.log(`${this.prefixText}ℹ️ ${message}`);
      });
      this.spinner.succeed = bindMethod(this.options.logger.info, function (message) {
        /* eslint no-console: 0 */
        return console.log(`${this.prefixText}✅ ${message}`);
      });
      this.spinner.fail = bindMethod(this.options.logger.error, function (message) {
        /* eslint no-console: 0 */
        return console.log(`${this.prefixText}❌ ${message}`);
      });
      this.spinner.start = bindMethod(this.options.logger.debug, function (message) {
        /* eslint no-console: 0 */
        return console.log(`${this.prefixText}${message}`);
      });
      this.spinner.stopAndPersist = bindMethod(this.options.logger.info, function (obj) {
        /* eslint no-console: 0 */
        return console.log(`${this.prefixText}${obj.symbol || ''}${obj.text || ''}`);
      });
      this.spinner.stop = function () {};

      if (message) {
        this.spinner.start(message);
      }
      return this.spinner;
    }

    // logging disabled, do nothing
    const noop = function () {};
    this.spinner = {
      info: noop,
      succeed: noop,
      warn: noop,
      fail: noop,
      start: noop,
      stopAndPersist: noop,
      stop: noop,
    };

    if (message) {
      this.spinner.start(message);
    }
    return this.spinner;
  }
}

Runner.getCommandCount = function (commands, state) {
  let total = 0;
  commands.forEach((command) => {
    if (CommandLoop.isCommandLoop(command)) {
      const loop = new CommandLoop(command);
      total += loop.count(state);
    } else {
      total++;
    }
  });
  return total;
};

module.exports = Runner;

Runner.Command = Command;
Runner.CommandLoop = CommandLoop;
Runner.AbiReader = AbiReader;
Runner.ScriptReader = ScriptReader;
Runner.ProviderAware = ProviderAware;
