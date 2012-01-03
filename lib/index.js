var hasRule = /^Rewrite[A-Z][a-zA-Z]+/;
var findAction = /^(Rewrite[A-Z][a-zA-Z]+)\s+(.*)$/;
var ruleParamsWithFlags = /^(.*)\s+\[(.*?)\]$/;
var ruleParams = /^(.*)\s+(.+)$/;

var conditions = null;
var lineNo = 0;

var extractRewriteConditions = function (line) {
    return false; 
}

var makeRule = function (match, target) {
    var rule = {
        type: "rewrite",
        match: match,
        target: target
    };

    if (conditions) {
        rule.conditions = conditions;
        conditions = null; // Reset for next rule
    }

    return rule;
}

var extractRewriteRuleWithoutFlags = function (line) {
    var params = ruleParams(line); 

    var match = params[1].trim();
    var target = params[2].trim();

    var rule = makeRule(match, target);

    return rule;
}

var extractRewriteRuleWithFlags = function (line) {
    var params = ruleParamsWithFlags(line);

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
    var lines = input.split("\n"),
        rules = [];
    
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

        var matches = findAction(line);
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

var transform = function (rules) {
    var out = '';

    for (var i = 0; i < rules.length; i++) {
        var rule = rules[i];

        if (rule.type == 'blank') {
            out += rule.text + '\n';
        }

        if (rule.type == 'rewrite') {
            var match = rule.match;
            if (/\{.*\}/.test(match)) {
                match = "\"" + match + "\"";
            }

            var modifier = '';
            if (rule.last) {
                modifier = ' last';
            }

            if (rule.redirect) {
                modifier = rule.code == 301 ? ' permanent' : ' redirect';
            }
            out += 'rewrite ' + match + ' ' + rule.target + modifier + ';\n';
        }

        if (rule.type == 'status') {
            var line = 'return ' + rule.code + ';\n';

            if (rule.match) {
                line = 'if ($request_uri ~* ' + rule.match + ') {\n    ' + line + '}\n';
            }

            out += line;
        }
    }

    return out;
}

module.exports = function (str) {
    var rules = parse(str);
    return transform(rules);
}

module.exports.parse = parse;
module.exports.transform = transform;
