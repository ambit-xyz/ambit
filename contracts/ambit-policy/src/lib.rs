#![no_std]
//! `ambit-policy`: payee allow-list and cap per payment, `transfer` only.
//!
//! Not implemented yet.

use soroban_sdk::{contract, contractimpl};

#[contract]
pub struct AmbitPolicy;

#[contractimpl]
impl AmbitPolicy {}

#[cfg(test)]
mod test;
