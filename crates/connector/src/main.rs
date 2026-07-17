#![forbid(unsafe_code)]

fn main() {
    if let Err(error) = viberacing_connector::run_connector_cli() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
