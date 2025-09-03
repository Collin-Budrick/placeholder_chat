use anyhow::Result;

// Include generator at module scope so its `use` statements are valid
mod gen {
    include!(concat!(env!("CARGO_MANIFEST_DIR"), "/generator.rs"));
}

fn main() -> Result<()> {
    gen::run()
}
