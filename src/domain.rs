use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServiceState {
    Ok,
    Nok,
    Nak,
}

impl ServiceState {
    pub fn as_str(self) -> &'static str {
        match self {
            ServiceState::Ok => "ok",
            ServiceState::Nok => "nok",
            ServiceState::Nak => "nak",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "ok" => Some(ServiceState::Ok),
            "nok" => Some(ServiceState::Nok),
            "nak" => Some(ServiceState::Nak),
            _ => None,
        }
    }
}

/// Worst state ordering: nak > nok > ok (matches Node implementation).
pub fn worst_state(states: impl Iterator<Item = ServiceState>) -> ServiceState {
    let mut worst = ServiceState::Ok;
    for s in states {
        match s {
            ServiceState::Nak => return ServiceState::Nak,
            ServiceState::Nok => worst = ServiceState::Nok,
            ServiceState::Ok => {}
        }
    }
    worst
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worst_state_ordering() {
        assert_eq!(
            worst_state([ServiceState::Ok, ServiceState::Ok].into_iter()),
            ServiceState::Ok
        );
        assert_eq!(
            worst_state([ServiceState::Ok, ServiceState::Nok].into_iter()),
            ServiceState::Nok
        );
        assert_eq!(
            worst_state([ServiceState::Ok, ServiceState::Nak].into_iter()),
            ServiceState::Nak
        );
        assert_eq!(
            worst_state([ServiceState::Nok, ServiceState::Nak].into_iter()),
            ServiceState::Nak
        );
    }
}
