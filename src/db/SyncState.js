const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

// A single row holding how far the periodic pass has come. It is kept apart from the signer rows
// because the question it answers - the height everything below which is indexed - is not the same
// as the height of the newest signer: a multisig that failed to index leaves a gap behind it.
const SyncState = sequelize.define('SyncState', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
  },
  scannedHeight: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
});

module.exports = SyncState;
