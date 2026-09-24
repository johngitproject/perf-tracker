import { Component } from 'react'

export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Erreur d’interface :', error, info)
  }

  render() {
    if (this.state.error) {
      const msg =
        this.state.error && this.state.error.message
          ? this.state.error.message
          : String(this.state.error)
      return (
        <div className="error-boundary">
          <h2>Une erreur est survenue</h2>
          <p className="error-boundary-msg">{msg}</p>
          <div className="form-row" style={{ justifyContent: 'center' }}>
            <button className="btn primary" onClick={() => this.setState({ error: null })}>
              Recharger la vue
            </button>
            <button className="btn" onClick={() => window.location.reload()}>
              Recharger l’app
            </button>
          </div>
          <p className="info-note">
            Si l’erreur persiste, exportez une sauvegarde puis signalez ce message.
          </p>
        </div>
      )
    }
    return this.props.children
  }
}