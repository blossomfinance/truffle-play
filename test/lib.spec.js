'use strict';

/* global describe, it */
const Promise = require('bluebird');
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

const contracts = require('./expected/lib.contracts');
const inputs = ScriptReader.parseYaml(fs.readFileSync(path.join(__dirname, 'lib.inputs.yml'), 'utf8'));
const runner = new Runner({
  spinner: false,
  workingDirectory: __dirname,
});

describe('Runner (as lib)', function () {
  this.timeout(10000);

  it('runs deploy scripts with linking', async function () {
    const results = await runner.read(path.join(__dirname, 'playbooks/0-deploy.playbook.yml'), inputs);
    chai.expect(results[0][0]).to.have.property('address', contracts.Migrations.address);
    chai.expect(results[0][0].transaction).to.deep.include(contracts.Migrations.transaction);
    chai.expect(results[0][1]).to.be.undefined;
    chai.expect(results[0][2]).to.have.property('address', contracts.ConvertLib.address);
    chai.expect(results[0][2].transaction).to.deep.include(contracts.ConvertLib.transaction);
    chai.expect(results[0][3]).to.be.undefined;
    chai.expect(results[0][4]).to.have.property('address', contracts.MetaCoin.address);
    chai.expect(results[0][4].transaction).to.deep.include(contracts.MetaCoin.transaction);
  });

  it('runs instance methods', async function () {
    const args = {
      $deployed: {
        MetaCoin: contracts.MetaCoin.address,
      },
      $inputs: {
        sender: inputs.addresses[0],
        receiver: inputs.addresses[1],
        amount: '1000',
      },
    };
    const results = await runner.read(path.join(__dirname, 'playbooks/1-send.playbook.yml'), args);
    chai.expect(results[0][0]).to.deep.include({
      tx: '0x7bb26f9524edfbaf9553b3f31fb2830131b673e5f37405a38c1ce1e5c2f60c25',
    });
  });

  it('runs playbook that includes playbook by filename', async function () {
    const amount = '1000';
    const args = {
      $deployed: {
        MetaCoin: contracts.MetaCoin.address,
      },
      $inputs: {
        transfers: inputs.addresses.slice(2).map(address => ({
          address,
          amount,
        })),
        sender: inputs.addresses[0],
      },
    };
    await runner.read(path.join(__dirname, 'playbooks/bulk/send-multiple.playbook.yml'), args);
    await Promise.each(inputs.addresses.slice(2), async (address, i) => {
      const results = await runner.read([{
        contract: 'MetaCoin',
        run: 'getBalance',
        at: contracts.MetaCoin.address,
        inputs: [{
          holder: address,
        }],
      }]);
      chai.expect(results[0][0]).to.be.a.bignumber.that.equals(new BN(amount), `Address #${i}: ${address}`);
    });
  });

  describe('transformations', function () {
    it('applies output mapping', async function () {
      const results = await runner.read([{
        contract: 'MetaCoin',
        run: 'getBalanceInEth',
        at: contracts.MetaCoin.address,
        inputs: [{
          holder: inputs.addresses[0],
        }],
      }, {
        contract: 'MetaCoin',
        run: 'getBalance',
        at: contracts.MetaCoin.address,
        inputs: [{
          holder: inputs.addresses[1],
        }],
      }]);
      await chai.expect(results[0][0]).to.be.a('string').that.equals('2000');
      await chai.expect(results[1][0]).to.be.a.bignumber.that.equals(new BN('1000'));
    });

    it('applies type mapping', async function () {
      const results = await runner.read([{
        contract: 'MetaCoin',
        run: 'version',
        at: contracts.MetaCoin.address,
      }]);
      await chai.expect(results[0][0]).to.be.a('string').that.equals(String(inputs.version));
    });
  });

  describe('inputs merging', function () {
    it('merges inputs into $inputs leaving $deployed', async function () {
      await chai.expect(runner.read([{
        contract: 'MetaCoin',
        run: 'getBalance',
        at: '$deployed.MetaCoin.address',
        inputs: [{
          holder: '$inputs.address',
        }],
      }], {
        $deployed: contracts,
        address: inputs.addresses[2],
      })).to.be.fulfilled;
    });

    it('leaves $inputs and $deployed', async function () {
      await chai.expect(runner.read({
        contract: 'MetaCoin',
        run: 'getBalance',
        at: '$deployed.MetaCoin.address',
        inputs: [{
          holder: '$inputs.address',
        }],
      }, {
        $deployed: contracts,
        $inputs: {
          address: inputs.addresses[2],
        },
      })).to.be.fulfilled;
    });

    it('does not conflate $inputs and $deployed', async function () {
      await chai.expect(runner.read([{
        contract: 'MetaCoin',
        run: 'getBalance',
        at: '$deployed.MetaCoin.address',
        inputs: [{
          holder: '$inputs.address',
        }],
      }], {
        MetaCoin: contracts.MetaCoin.address,
        address: inputs.addresses[2],
      })).to.be.rejected;
    });
  });
});
