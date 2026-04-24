import "./styles.css";

import logo from "#assets/logo.svg";

const appVersion = __APP_VERSION__;

export function About() {
  return (
    <div className="About">
      <div className="logo">
        <img src={logo} width="128" height="128" alt="Favicon Speed Dial" />
        <div className="right">
          <p className="title">Favicon Speed Dial</p>
          <p className="small">Version {appVersion}</p>
          <p>
            Need help or found a bug? Please open an issue on the{" "}
            <a href="https://github.com/ctuzzeo/favicon-speed-dial" rel="noreferrer" target="_blank">
              GitHub repository
            </a>
            .
          </p>
        </div>
      </div>
      <div className="details">
        <p className="copyright">
          <strong>Favicon Speed Dial</strong> is developed as a fork built on top of{" "}
          <a href="https://easyspeeddial.com/" rel="noreferrer" target="_blank">
            Easy Speed Dial
          </a>{" "}
          by{" "}
          <a href="https://lucaseverett.dev/" rel="noreferrer" target="_blank">
            Lucas Everett
          </a>
          . We are grateful for the original project and the MIT-licensed codebase we could
          extend. Upstream source:{" "}
          <a href="https://github.com/lucaseverett/easy-speed-dial" rel="noreferrer" target="_blank">
            github.com/lucaseverett/easy-speed-dial
          </a>
          .
        </p>
        <p className="copyright">
          Copyright &copy; 2018&ndash;{new Date().getFullYear()} Lucas Everett. This fork and
          subsequent changes are copyright Christopher Tuzzeo. Released under the{" "}
          <a
            href="https://github.com/ctuzzeo/favicon-speed-dial/blob/main/LICENSE"
            rel="noreferrer"
            target="_blank"
          >
            MIT License
          </a>
          .
        </p>
      </div>
    </div>
  );
}
