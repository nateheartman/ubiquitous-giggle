fn main() {
    swift_runtime_search_path();
    llama_dylib_rpath();
    tauri_build::build()
}

/// ScreenCaptureKit's Rust bindings (system audio for /meet) include a small
/// Swift library, whose compatibility shims the linker looks for next to the
/// Swift compiler. The crate only knows Xcode's layout; with just the Command
/// Line Tools installed they live elsewhere, so point the linker there too.
fn swift_runtime_search_path() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    let found = std::process::Command::new("xcrun")
        .args(["--find", "swiftc"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok());
    // .../usr/bin/swiftc -> .../usr/lib/swift/macosx
    if let Some(dir) = found
        .as_deref()
        .map(|p| std::path::Path::new(p.trim()))
        .and_then(|p| p.parent()?.parent().map(|usr| usr.join("lib/swift/macosx")))
        .filter(|d| d.is_dir())
    {
        println!("cargo:rustc-link-search=native={}", dir.display());
    }
    // The bridge's Swift runtime libraries (concurrency among them) come with
    // macOS; the crate's own rpath for them doesn't reach this program.
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
}

/// llama.cpp is linked as dylibs (see Cargo.toml). The app finds them in
/// `Contents/Frameworks`, where the bundle puts them (tauri.macos.conf.json);
/// a debug binary run straight from `target/debug` (tests, `tauri dev`) finds
/// them next to itself, where llama-cpp-sys-2 writes them.
fn llama_dylib_rpath() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
    // Debug builds only: a release names no folder from the machine that built it.
    // OUT_DIR is target/<profile>/build/<crate>-<hash>/out.
    if std::env::var("PROFILE").as_deref() != Ok("debug") {
        return;
    }
    if let Some(profile) = std::env::var("OUT_DIR").ok().as_deref().map(std::path::Path::new).and_then(|p| p.ancestors().nth(3)) {
        println!("cargo:rustc-link-arg=-Wl,-rpath,{}", profile.display());
    }
}
