var hasRule = /^Rewrite[A-Z][a-zA-Z]+/;
var findAction = /^(Rewrite[A-Z][a-zA-Z]+)\s+(.*)$/;
var ruleParamsWithFlags = /^(.*)\s+\[(.*?)\]$/;
var ruleParams = /^(.*)\s+(.+)$/;
var condParams = /^(.*)\s+(.+)$/;
var condVariableTest = /^%\{(.+)\}$/;
var condPatternCond = /^(!|)-\w$/;

var conditions = [];
var lineNo = 0;
var lines = [];

var cond_var_map = {
    '%{REQUEST_FILENAME}': '$request_filename'
};

var cond_test_map = {
    '-f': '-f',
    '-d': '-d',
    '-x': '-x'
}

var extractRewriteConditions = function (line) {
    var params = ruleParams.exec(line); 
    if (!params || params.length != 3) {
        return false;
    }

    var test = params[1].trim();
    var cond = params[2].trim();

    if (condVariableTest.test(test)) {
        if (!cond_var_map[test]) {
            return false;
        }

        test = cond_var_map[test];
    }

    if (condPatternCond.test(cond)) {
        var not = false;
        if (cond[0] == '!') {
            not = true;
            cond = cond.slice(1);
        }

        if (!cond_test_map[cond]) {
            return false;
        }

        conditions.push((not ? '!' : '') + cond_test_map[cond] + ' ' + test);
        return true;
    }

    return false; 
}

var makeRule = function (match, target) {
    var rule = {
        type: "rewrite",
        match: match,
        target: target
    };

    if (conditions.length > 0) {
        rule.conditions = conditions;
        conditions = []; // Reset for next rule
    }

    return rule;
}

var extractRewriteRuleWithoutFlags = function (line) {
    var params = ruleParams.exec(line); 

    var match = params[1].trim();
    var target = params[2].trim();

    var rule = makeRule(match, target);

    return rule;
}

var extractRewriteRuleWithFlags = function (line) {
    var params = ruleParamsWithFlags.exec(line);

    if (!params) return null;

    var rest = params[1].trim();
    var rule = extractRewriteRuleWithoutFlags(rest);
    if (!rule) return null;

    var flags = params[2].split(',');

    for (var i = 0; i < flags.length; i++) {
        var flag = flags[i].split('=');

        switch (flag[0]) {
            case 'F':
                return {
                    type: "status",
                    code: 403,
                    match: rule.match
                }

            case 'L':
                rule.last = true;
                break;

            case 'R':
                rule.redirect = true;
                rule.code = flag[1] || 302;
                break;

            default:
                return {
                    type: "warning",
                    warning: "unsupported_flag",
                    line: lineNo,
                    text: flag[0]
                }
        }
    }

    return rule;    
}

var extractRewriteRule = function (line) {
    var rule = extractRewriteRuleWithFlags(line);
    if (rule) return rule;

    rule = extractRewriteRuleWithoutFlags(line);
    if (rule) return rule;

    return null;
}

var parse = function (input) {
    lines = input.split("\n");
    var rules = [];
    
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        lineNo = i + 1;

        line = line.trim();
        if (line == '' && lineNo == lines.length) {
            continue;
        }

        if (line == '' || /^#/.test(line)) {
            rules.push({
                type: "blank",
                text: line
            });
            continue;
        }

        if (!hasRule.test(line)) {
            rules.push({
                type: "warning",
                warning: "unknown",
                line: lineNo,
                text: line
            });
            continue;
        }

        var matches = findAction.exec(line);
        var action = matches[1];

        switch (action) {
            case "RewriteEngine":
                // Do nothing
                break;

            case "RewriteCond":
                var supported = extractRewriteConditions(matches[2]);
                if (!supported) {
                    rules.push({
                        type: "warning",
                        warning: "unsupported_condition",
                        line: lineNo,
                        text: matches[2]
                    });
                }
                break;

            case "RewriteRule":
                var supported = rules.push(extractRewriteRule(matches[2]));
                if (!supported) {
                    rules.push({
                        type: "warning",
                        warning: "unsupported_rule",
                        line: lineNo,
                        text: matches[2]
                    });
                }
                break;

            default:
                rules.push({
                    type: "warning",
                    warning: "unsupported",
                    line: lineNo,
                    text: line
                });
        }
    }
    return rules;
}

var transform = function (rules, options) {
    if (!options) {
        options = {
            output_warnings: true
        }
    }

    var out = [];

    for (var i = 0; i < rules.length; i++) {
        var rule = rules[i];
        var line = null;

        if (rule.type == 'blank') {
            line = rule.text;
        }

        if (rule.type == 'rewrite') {
            var match = rule.match;

            if (/^\^/.test(match)) {
                // NGinx expects matches to start with a slash, Apache doesn't.
                match = '^/' + match.slice(1);
            }

            if (/\{.*\}/.test(match)) {
                // From the nginx manual:
                //
                //   Note: for curly braces( { and } ), as they are used
                //   both in regexes and for block control, to avoid
                //   conflicts, regexes with curly braces are to be
                //   enclosed with double quotes (or single quotes).
                match = "\"" + match + "\"";
            }

            var modifier = '';
            if (rule.last) {
                modifier = ' last';
            }

            if (rule.redirect) {
                modifier = rule.code == 301 ? ' permanent' : ' redirect';
            }
            line = 'rewrite ' + match + ' ' + rule.target + modifier + ';';
            if (rule.conditions) {
                if (rule.conditions.length > 1) {
                    throw new Error('Do not support multiple conditions yet!');
                }

                line = 'if (' + rule.conditions[0] + ') {\n    ' + line + '\n}';
            }
        }

        if (rule.type == 'status') {
            line = 'return ' + rule.code + ';';

            if (rule.match) {
                line = 'if ($request_uri ~* ' + rule.match + ') {\n    ' + line + '\n}';
            }
        }

        if (rule.type == 'warning' && options.output_warnings) {
            line = '# Warning: ' + rule.warning + ' at line ' + rule.line + ':\n# ' + lines[rule.line - 1];
        }

        if (line != null) {
            out.push(line);
        }
    }

    return out;
}

var join = function (lines) {
    return lines ? (lines.join('\n') + '\n') : '';
}

module.exports = function (str, options) {
    var rules = parse(str);
    return join(transform(rules, options));
}

module.exports.parse = parse;
module.exports.transform = transform;
module.exports.join = join;
