#!/usr/bin/env node

'use strict';

const merge = require('deepmerge');
const path = require('path');
const yargs = require('yargs');

const Runner = require('./');
const ScriptReader = require('./lib/script-reader');

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
        input: {
          description: 'Path to a file that contains inputs.',
          alias: ['inputs', 'i'],
          type: 'string',
        },
        debug: {
          description: 'Write inputs and outputs to console',
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

        // ensure relative paths of input files coerced into absolute
        // using the workingDirectory
        if (argv.inputs) {
          const inputsPath = argv.inputs;
          argv.inputs = runner.scriptReader.merge(inputsPath);
          if (!Object.keys(argv.inputs).length) {
            runner.spinner.warn(`No inputs found from ${inputsPath}`);
          }
        }

        const $inputs = argv.inputs || {};
        // deployed is a special case
        // as this could be output from a state dump
        const $deployed = $inputs.$deployed || {};

        // add inputs to the initial state
        if (Array.isArray(argv.state)) {
          throw new Error('State should not be an array; usage: --state.property.subproperty');
        }
        const state = merge({
          $deployed,
          $inputs,
        }, {
          $inputs: argv.state || {},
        });

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
