# Truffle Declarative

**Devops for the Ethereum Blockchain**

A declarative, domain-specific language that makes managing mission-critical
smart contracts easier called 'playbooks'.

Write E2E tests that run on the same code you'll use in production.

No magic, just easy to understand (human readible) files that describe what needs to happen.

Test framework agnostic - use whatever you like. Playbooks don't

## Command Line

```Bash
./node_modules/.bin/truffle-play playbooks/deploy.playbook.yml --env.from 0xe78A0F7E598Cc8b0Bb87894B0F60dD2a88d6a8Ab
```

## Programmatic

```JavaScript
const TruffleDeclarative = require('truffle-declarative');
// automatically picks up truffle.js config:
const run = new TruffleDeclarative({
  output: 'results.yml',
  networkName: 'development',
  dryRun: true
});
// no need for boilerplate code; just say what you want to happen:
const results = await run({
  description: 'Deploy a new version of SafeMathLib',
  contract: 'SafeMathLib',
  run: 'new',
  inputs: [{
    from: '0x1f9c410d5562bb6590b8f891f2e26311f9a6ef8c',
    gasPrice: 11e9,
  }],
  outputs: {
    'address': 'safeMathLib'
  }
});
const [ address ] = results[0];
// inspect all the values in one easy go:
const values = run.mapper.map('SafeMathLib', address);
```

## Special

Run special utils, such as `truffle-object-mapper`:

```javascript

const TruffleDeclarative = require('truffle-declarative');
const run = new TruffleDeclarative({
  map: path.join(__dirname, 'map.js'),
});

const results = await run([{
  description: 'Dump the current contract',
  contract: 'CouponStorage',
  at: '0x1f9c410d5562bb6590b8f891f2e26311f9a6ef8c',
  run: 'util.map'
}]);

```

# TODO

## Bugs

- Loop including playbook by file gives wrong count of tasks it will perform

## Docs Needed

- Definition of domain specific language
- Loop example
- Input state explained
- Output dump demo
- Passing state between multiple playbooks via $deployed
