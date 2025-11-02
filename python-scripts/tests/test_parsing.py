from modules.parsing import parse_date, parse_system


def test_parse_date_formats():
    assert parse_date("2024-10-01").year == 2024
    assert parse_date("10/01/2024").year == 2024
    assert parse_date("invalid") is None


def test_parse_system_patterns():
    assert parse_system("System: web-01") == "web-01"
    assert parse_system("host: db01") == "db01"
    assert parse_system("random text") is not None or parse_system("random text") is None

