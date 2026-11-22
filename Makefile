PREFIX ?= /usr
DOCDIR ?= $(PREFIX)/share/doc/mushroom-desktop
.PHONY: install check
install:
	install -d $(DESTDIR)$(PREFIX)/share/gnome-shell/extensions $(DESTDIR)$(PREFIX)/bin $(DESTDIR)$(DOCDIR)
	for extension in extensions/*; do \
	  target="$(DESTDIR)$(PREFIX)/share/gnome-shell/extensions/$$(basename "$$extension")"; \
	  install -d "$$target"; install -m 0644 "$$extension"/* "$$target/"; \
	done
	install -m 0755 bin/mushroom-desktop $(DESTDIR)$(PREFIX)/bin/mushroom-desktop
	install -m 0644 COPYING README.md VERSION docs/config.example.json $(DESTDIR)$(DOCDIR)/
check:
	python3 tests/check-package.py
