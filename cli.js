#!/usr/bin/env node

'use strict';

const merge = require('deepmerge');
const path = require('path');
const yargs = require('yargs');

const Runner = require('./');
const ScriptReader = require('./lib/script-reader');

const defaultWorkingDirectory = path.join(__dirname, '/../../');

yargs
  .usage("$0 <path..>")
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
          coerce: (arg) => ScriptReader.coerceRelativePath(arg, __dirname),
          default: defaultWorkingDirectory
        },
        state: {
          description: 'Values to pass to the state which may be referenced in scripts.',
          alias: 'env',
          type: 'string'
        },
        networkName: {
          description: 'Network name to run transactions on. Should correspond to one defined in truffle.js',
          alias: 'n',
          type: 'string',
          default: 'development'
        },
        results: {
          description: 'Path to output result logs of transactions succeeded and failed. Failed tasks can be replayed later.',
          alias: 'resultsDir',
          type: 'string',
        },
        interactive: {
          description: 'Whether to prompt to confirm each step.',
          default: true,
          type: 'boolean'
        },
        input: {
          description: 'Path to a file that contains inputs.',
          alias: ['inputs', 'i'],
          type: 'string'
        },
        delay: {
          description: 'Delay between methods',
          type: 'number',
          default: 0,
          hidden: true
        },
        dump: {
          description: 'Whether to dump state upon finish',
          type: 'boolean',
          default: false,
          implies: ['dumpPath']
        },
        dumpPath: {
          description: 'A list of paths that should be dumped.',
          type: 'array',
          default: ['$deployed'],
          hidden: true
        },
        dumpFilename: {
          description: 'Where to dump the state upon finish',
          type: 'string',
          hidden: true
        },
        contracts: {
          description: 'Path to location of contract arficats (ABI) JSON files',
          type: 'string',
          hidden: true
        },
        closeOnFinish: {
          description: 'Whether to shut down provider connections and dangling event listeners upon finish.',
          hidden: true,
          type: 'boolean',
          default: true,
        },
      });
    },
    handler: async (argv) => {
      try {
        argv.scriptDirectory = __dirname;

        const runner = new Runner(argv);

        // ensure relative paths of input files coerced into absolute
        // using the workingDirectory
        if (argv.inputs) {
          argv.inputs = runner.scriptReader.merge(argv.inputs);
        }

        const $inputs = argv.inputs || {};
        // deployed is a special case
        // as this could be output from a state dump
        const $deployed = $inputs.$deployed || {};

        // add inputs to the initial state
        const state = merge({
          $deployed,
          $inputs
        }, argv.state || {});

        // run list of script files found at specified path(s)
        await runner.read(argv.path, state);
      } catch (err) {
        console.error('Failed with error:', err);
      }
    }
  })
  .strict(true)
  .demandCommand()
  .help()
  .argv;
