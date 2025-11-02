from modules.classifier import classify


def test_classifier_logging_keyword():
    r = classify("Log collector and audit trail present")
    assert any(x.get("control_code") == "10.2.1" for x in r)


def test_classifier_auth_keyword():
    r = classify("Password policy enforced with MFA login")
    assert any(x.get("control_code") == "8.2.3" for x in r)

