const { Umzug, SequelizeStorage } = require('umzug');
const { sequelize } = require('./db.js');

const umzug = new Umzug({
  migrations: { glob: 'migrations/*.js' },
  context: sequelize.getQueryInterface(),
  storage: new SequelizeStorage({ sequelize }),
  logger: console,
});

async function migrate() {
  return umzug.up();
}

async function revert() {
  return umzug.down({ to: 0 });
}

module.exports = {
  migrate,
};
