var fs = require('fs');
var assert = require('assert');
var convert = require('./../lib/index.js');

var options = {
    output_warnings: false
};

var mkSuite = function (file) {
    var input = fs.readFileSync(__dirname + '/' + file, 'utf8');
    var rules = JSON.parse(fs.readFileSync(__dirname + '/' + file + '.json', 'utf8'));
    var out = fs.readFileSync(__dirname + '/' + file + '.out', 'utf8');

    var parsed = null;
    var converted = null;

    suite(file, function () {
        test('Rules are parsed without error', function () {
            parsed = convert.parse(input);
        });

        test('Rule sets are equal', function () {
            assert.notEqual(parsed, null);
            assert.deepEqual(rules, parsed); 
        });

        test('Rules are converted without error', function () {
            assert.notEqual(parsed, null);
            converted = convert.transform(parsed, options);
        });

        test('Outputs are equal', function () {
            assert.notEqual(parsed, null);
            assert.equal(out, converted); 
        });

        test('Convenience wrapper does the same thing', function () {
            assert.equal(convert(input, options), out);
        });
    });
}

var files = fs.readdirSync(__dirname);
for (var i = 0; i < files.length; i++) {
    var file = files[i];

    if (!/\.rules$/.test(file)) {
        continue;
    }

    mkSuite(file);
}
