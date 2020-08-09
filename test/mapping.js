'use strict';

const Web3 = require('web3');

module.exports = {
  types: {
    uint8: val => Web3.utils.BN(val).toString(),
  },
  mapping: {
    when: {
      key: 'when',
      transform: val => new Date(val * 1000),
    },
    getBalanceInEth: {
      key: 'balanceInEth',
      transform: val => Web3.utils.BN(val).toString(),
    },
  },
};
