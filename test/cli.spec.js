'use strict';

/* global before, describe, it */
const BN = require('bn.js');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const chaiBN = require('chai-bn');
const fs = require('fs');
const path = require('path');

chai.use(chaiBN(BN));
chai.use(chaiAsPromised);

const Runner = require('./../');
const { ScriptReader } = Runner;
const contracts = require('./expected/cli.contracts');

describe('Runner (as cli)', function () {
  let inputs;
  let runner;
  let metacoin;
  before(async function () {
    inputs = ScriptReader.parseYaml(fs.readFileSync(path.join(__dirname, 'cli.inputs.yml'), 'utf8'));
    runner = new Runner({
      spinner: false,
      workingDirectory: __dirname,
    });
    metacoin = await runner.contractAt('MetaCoin', contracts.MetaCoin.address);
  });

  it('runs deploy scripts with linking', async function () {
    const values = await runner.mapper.map('MetaCoin', contracts.MetaCoin.address);
    chai.expect(values).to.have.property('name', 'Fancy MetaCoin Example');
    chai.expect(values).to.have.deep.property('when', new Date(2020, 0, 1, 0, 0, 0));
  });

  it('runs instance methods from single script', async function () {
    const balance = await metacoin.getBalance(inputs.receiver);
    chai.expect(balance).to.be.a.bignumber.that.equals(new BN(inputs.amount), `Receiver ${inputs.receiver}`);
  });
});
