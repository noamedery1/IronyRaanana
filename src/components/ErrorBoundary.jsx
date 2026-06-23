import { Component } from 'react';
import ErrorPage from '../pages/ErrorPage.jsx';

// Catches any runtime render/lifecycle crash in the tree below it and shows the
// designed ErrorPage instead of a blank white screen (React unmounts the whole
// tree on an uncaught error). Wraps the entire app in main.jsx.
export default class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error, info) {
        // Keep a console trace for debugging; the user sees the friendly page.
        console.error('App crashed:', error, info);
    }

    render() {
        if (this.state.hasError) return <ErrorPage mode="error" />;
        return this.props.children;
    }
}
