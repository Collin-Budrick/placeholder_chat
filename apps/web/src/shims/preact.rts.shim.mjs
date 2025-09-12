// Minimal shim for `preact-render-to-string` and its stream variant used by preact/compat/server.
export function renderToString() {
	return "";
}

export function render() {
	return "";
}

export function renderToReadableStream() {
	try {
		// eslint-disable-next-line no-undef
		return new ReadableStream({
			start(controller) {
				controller.close?.();
			},
		});
	} catch {
		return {};
	}
}
