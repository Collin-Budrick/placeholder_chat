fn main() {
    // Compile Cap'n Proto schemas into Rust sources placed in OUT_DIR.
    // The capnpc build-dependency is declared in Cargo.toml.
    if let Err(e) = capnpc::CompilerCommand::new()
        .src_prefix("schema")
        .file("schema/message.capnp")
        .run()
    {
        panic!("capnp compile failed: {}", e);
    }
}
