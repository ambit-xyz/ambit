use soroban_sdk::Env;

use crate::AmbitPolicy;

#[test]
fn registers() {
    let env = Env::default();
    env.register(AmbitPolicy, ());
}
