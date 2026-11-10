use super::field::use_lowercase;
use serde_yaml_ng::{self, Mapping, Sequence, Value};

const PREPEND_RULES: &str = "prepend-rules";
const APPEND_RULES: &str = "append-rules";

fn take_rules(merge: &mut Mapping, key: &str) -> Option<Sequence> {
    merge
        .remove(Value::from(key))
        .and_then(|value| value.as_sequence().cloned())
}

/// Splices the merge file's rule lists into the profile rules; identical rules already present are kept once.
fn apply_rule_edits(config: &mut Mapping, prepend: Option<Sequence>, append: Option<Sequence>) {
    if prepend.is_none() && append.is_none() {
        return;
    }

    let rules = match config.remove(Value::from("rules")) {
        Some(Value::Sequence(rules)) => rules,
        Some(other) => {
            config.insert(Value::from("rules"), other);
            return;
        }
        None => Sequence::new(),
    };

    let mut seen = rules.clone();
    let mut splice = |edits: Option<Sequence>| {
        let mut kept = Sequence::new();
        for rule in edits.into_iter().flatten() {
            if !seen.contains(&rule) {
                seen.push(rule.clone());
                kept.push(rule);
            }
        }
        kept
    };
    let prepend_rules = splice(prepend);
    let append_rules = splice(append);

    let mut updated = prepend_rules;
    updated.extend(rules);
    updated.extend(append_rules);
    config.insert(Value::from("rules"), Value::Sequence(updated));
}

fn deep_merge(a: &mut Value, b: Value) {
    match (a, b) {
        (Value::Mapping(a_map), Value::Mapping(b_map)) => {
            for (key, value) in b_map {
                if let Some(existing) = a_map.get_mut(&key) {
                    deep_merge(existing, value);
                } else {
                    a_map.insert(key, value);
                }
            }
        }
        (a, b) => *a = b,
    }
}

pub fn use_merge(merge: &Mapping, mut config: Mapping) -> Mapping {
    let mut merge = use_lowercase(merge);
    let prepend_rules = take_rules(&mut merge, PREPEND_RULES);
    let append_rules = take_rules(&mut merge, APPEND_RULES);

    for (key, value) in merge {
        match (config.get_mut(&key), value) {
            (Some(Value::Mapping(existing)), Value::Mapping(overlay)) if key.as_str() == Some("dns") => {
                existing.extend(overlay);
            }
            (Some(existing), value) if key.as_str() != Some("hosts") => deep_merge(existing, value),
            (_, value) => {
                config.insert(key, value);
            }
        }
    }

    apply_rule_edits(&mut config, prepend_rules, append_rules);
    config
}

#[test]
fn test_merge() -> anyhow::Result<()> {
    let merge = r"
    prepend-rules:
      - prepend
      - 1123123
    append-rules:
      - append
    prepend-proxies:
      - 9999
    append-proxies:
      - 1111
    rules:
      - replace
    proxy-groups: 
      - 123781923810
    tun:
      enable: true
    dns:
      enable: true
      nameserver-policy:
        new.example: 1.1.1.1
      fallback-filter:
        geoip: false
    hosts:
      new.example: 192.0.2.2
  ";

    let config = r"
    rules:
      - aaaaa
    script1: test
    tun:
      mtu: 1500
    dns:
      nameserver: [9.9.9.9]
      nameserver-policy:
        old.example: 8.8.8.8
      fallback-filter:
        geoip: true
        domain: [old.example]
    hosts:
      old.example: 192.0.2.1
  ";

    let merge = serde_yaml_ng::from_str::<Mapping>(merge)?;
    let config = serde_yaml_ng::from_str::<Mapping>(config)?;

    let result = use_merge(&merge, config);
    assert_eq!(result["dns"]["nameserver-policy"], merge["dns"]["nameserver-policy"]);
    assert_eq!(result["dns"]["fallback-filter"], merge["dns"]["fallback-filter"]);
    assert_eq!(result["hosts"], merge["hosts"]);
    assert_eq!(result["dns"]["nameserver"], serde_yaml_ng::to_value(["9.9.9.9"])?);
    assert_eq!(result["tun"]["mtu"], Value::from(1500));
    assert_eq!(
        result["rules"],
        Value::Sequence(vec![
            Value::from("prepend"),
            Value::from(1123123),
            Value::from("replace"),
            Value::from("append"),
        ])
    );
    assert_eq!(result["script1"], Value::from("test"));

    let cleared = serde_yaml_ng::from_str::<Mapping>(
        "dns: {enable: false, nameserver-policy: {}, fallback-filter: {}, nameserver: []}\nhosts: {}",
    )?;
    let result = use_merge(&cleared, result);
    assert_eq!(result["dns"], cleared["dns"]);
    assert_eq!(result["hosts"], cleared["hosts"]);

    Ok(())
}

#[test]
#[allow(clippy::expect_used, reason = "tests assert by panicking")]
fn test_merge_rule_edits() -> anyhow::Result<()> {
    let merge = serde_yaml_ng::from_str::<Mapping>(
        r#"
    prepend-rules:
      - "DOMAIN-SUFFIX,example.com,DIRECT"
      - "IP-CIDR,1.2.3.4/32,DIRECT,no-resolve"
    append-rules:
      - "DOMAIN-SUFFIX,tail.example.com,REJECT"
      - "DOMAIN-SUFFIX,example.com,DIRECT"
  "#,
    )?;
    let config = serde_yaml_ng::from_str::<Mapping>(
        r#"
    rules:
      - "DOMAIN-SUFFIX,example.com,DIRECT"
      - "MATCH,PROXY"
  "#,
    )?;

    let result = use_merge(&merge, config);
    let rules = result["rules"]
        .as_sequence()
        .expect("rules should stay a sequence")
        .iter()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>();

    assert_eq!(
        rules,
        [
            "IP-CIDR,1.2.3.4/32,DIRECT,no-resolve",
            "DOMAIN-SUFFIX,example.com,DIRECT",
            "MATCH,PROXY",
            "DOMAIN-SUFFIX,tail.example.com,REJECT",
        ]
    );
    assert!(!result.contains_key("prepend-rules"));
    assert!(!result.contains_key("append-rules"));

    Ok(())
}
