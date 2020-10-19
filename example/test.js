var canbus = require('..');

canbus = new canbus();

canbus.list()
  .then((ports) => {
    //console.log(ports);
    canbus.open(ports);
  });
