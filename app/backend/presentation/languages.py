"""Existing preview and canonical language envelopes; dictionaries own strings."""
PREVIEW_LANGUAGES = [
    {
        "id": 1,
        "code": "it",
        "name_native": "Italiano",
        "name_english": "Italian",
        "direction": "ltr",
        "is_active": True,
        "sort_order": 1,
    },
    {
        "id": 2,
        "code": "en",
        "name_native": "English",
        "name_english": "English",
        "direction": "ltr",
        "is_active": True,
        "sort_order": 2,
    },
    {
        "id": 3,
        "code": "fr",
        "name_native": "Français",
        "name_english": "French",
        "direction": "ltr",
        "is_active": True,
        "sort_order": 3,
    },
    {
        "id": 4,
        "code": "ar",
        "name_native": "العربية",
        "name_english": "Arabic",
        "direction": "rtl",
        "is_active": True,
        "sort_order": 4,
    },
]
PUBLIC_LANGUAGES = [{"id": i, "code": code, "name_native": name, "name_english": name,
              "direction": "rtl" if code == "ar" else "ltr", "is_active": True}
             for i, (code, name) in enumerate([("it", "Italiano"), ("en", "English"),
                                              ("fr", "Français"), ("ar", "العربية")], 1)]
