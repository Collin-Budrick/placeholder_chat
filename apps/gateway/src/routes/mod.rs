// Route module aggregator
//
// Each submodule defines a focused set of routes. This module exposes a
// single `all()` function to compose them into one router which is then
// wired up in main.rs.
use axum::Router;
use crate::state::AppState;

pub mod auth;
pub mod admin;
pub mod dev;
pub mod rooms;
pub mod ws;
pub mod logs;
pub mod root;

/// Merge all route groups into a single router.
pub fn all() -> Router<AppState> {
    Router::new()
        .merge(root::router())
        .merge(ws::router())
        .merge(rooms::router())
        .merge(logs::router())
        .merge(dev::router())
        .merge(auth::public())
        .merge(auth::protected())
        .merge(admin::router())
}
