// Example that lists all available CAN ports on a system

const Can = require('..');

let board = new Can({
  canRate: 250000,
});

board.list()
.then((ports) => {
  console.log(ports);
});
