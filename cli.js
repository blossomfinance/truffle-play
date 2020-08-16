#!/usr/bin/env node

'use strict';

const merge = require('deepmerge');
const path = require('path');
const yargs = require('yargs');
const util = require('util');

const Runner = require('./');
const ScriptReader = require('./lib/script-reader');
const formatStateArgs = require('./lib/format-state-args');

const defaultWorkingDirectory = path.join(__dirname, '/../../');

yargs
  .usage('$0 <path..>')
  .command({
    command: '$0 <path..>',
    desc: 'Run the blockchain scripts defined by the list of files.',
    builder: (yargs) => {
      yargs.positional('path', {
        describe: 'Glob path of scripts to run. This can be the output yaml from a previously failed run.',
        type: 'string',
      });
      yargs.options({
        workingDirectory: {
          alias: 'd',
          description: 'Location of truffle project.',
          type: 'string',
          coerce: arg => ScriptReader.coerceRelativePath(arg, __dirname),
          default: defaultWorkingDirectory,
        },
        state: {
          description: 'Values to pass to the state which may be referenced in scripts.',
          alias: 'env',
          type: 'string',
        },
        networkName: {
          description: 'Network name to run transactions on. Should correspond to one defined in truffle.js',
          alias: 'n',
          type: 'string',
          default: 'development',
        },
        results: {
          description: 'Path to output result logs of transactions succeeded and failed. Failed tasks can be replayed later.',
          alias: 'resultsDir',
          type: 'string',
        },
        interactive: {
          description: 'Whether to prompt to confirm each step.',
          default: true,
          type: 'boolean',
        },
        inputs: {
          description: 'Path(s) to a file containing inputs and/or individual properties to set on the state.$inputs. Files will be loaded and parsed.',
          alias: ['input', 'i'],
          type: 'string',
        },
        deployed: {
          description: 'Path(s) to a file containing addresses of deployed contracts and/or individual properties to set on the state.$deployed. Files will be loaded and parsed.',
          alias: ['e'],
          type: 'string',
        },
        debug: {
          description: 'Log initial state, inputs, and outputs to console',
          alias: ['verbose', 'v'],
          type: 'boolean',
        },
        debugInspectDepth: {
          description: 'How deep to print objects (util.inspect depth)',
          type: 'number',
          default: 5,
          hidden: true,
        },
        delay: {
          description: 'Delay between methods',
          type: 'number',
          default: 0,
          hidden: true,
        },
        dump: {
          description: 'Whether to dump state upon finish',
          type: 'boolean',
          default: false,
          implies: ['dumpPath'],
        },
        dumpFilename: {
          description: 'Where to dump the state upon finish',
          type: 'string',
        },
        dumpPath: {
          description: 'A list of paths that should be dumped.',
          type: 'array',
          default: ['$deployed'],
          hidden: true,
        },
        contracts: {
          description: 'Path to location of contract arficats (ABI) JSON files',
          type: 'string',
          hidden: true,
        },
        closeOnFinish: {
          description: 'Whether to shut down provider connections and dangling event listeners upon finish.',
          hidden: true,
          type: 'boolean',
          default: true,
        },
        mapping: {
          description: 'Path to a definition of a map to be used by truffle-object-mapper for calls to util.map',
          hidden: false,
          type: 'string',
          default: 'mapping.js',
        },
        spinner: {
          description: 'Show progress information in the form of a spinner',
          type: 'boolean',
          default: true,
        },
        logger: {
          description: 'If spinner is disabled, log output to conventional std and stderr streams',
          type: 'boolean',
          default: false,
        },
      });
    },
    handler: async (argv) => {
      let runner;
      try {
        argv.scriptDirectory = __dirname;

        runner = new Runner(argv);

        const objectifyArgvProperty = formatStateArgs(runner.scriptReader);
        // ensure relative paths of input files coerced into absolute
        // using the workingDirectory
        const $inputs = objectifyArgvProperty(argv.inputs, '$inputs');
        const $deployed = merge($inputs.$deployed, objectifyArgvProperty(argv.deployed, '$deployed'));
        delete $inputs.$deployed;

        const state = {
          $deployed,
          $inputs,
        };
        if (argv.debug) {
          const deserializedState = util.inspect(state, {
            depth: argv.debugInspectDepth,
          });
          runner.spinner.info(`Initial state is: \n${deserializedState}`);
        }

        // run list of script files found at specified path(s)
        await runner.read(argv.path, state);
      } catch (err) {
        /* eslint no-console: 0 */
        console.error('Failed with error:', err);
        console.error(err.stack);
      }
    },
  })
  .strict(true)
  .demandCommand()
  .help()
  .argv;
