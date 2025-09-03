fn main() {
    // Tauri build helper - generates config/context at compile time (OUT_DIR)
    // This must be present so `tauri::generate_context!()` in main.rs can read the generated files.
    tauri_build::build();
}
