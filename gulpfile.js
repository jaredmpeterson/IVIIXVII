var gulp = require('gulp');
var args = require('yargs').argv;
var browserSync = require('browser-sync');
var config = require('./gulp.config')();
var del = require('del');
var $ = require('gulp-load-plugins')({
    lazy: true
});

var colors = $.util.colors;
var envenv = $.util.env;
var port = process.env.PORT || config.defaultPort;

gulp.task('help', $.taskListing);
gulp.task('default', ['help']);

gulp.task('vet', function () {
    log('Analyzing source with JSHint and JSCS');

    return gulp
        .src(config.alljs)
        .pipe($.if(args.verbose, $.print()))
        .pipe($.jscs())
        .pipe($.jshint())
        .pipe($.jshint.reporter('jshint-stylish', {
            verbose: true
        }))
        .pipe($.jshint.reporter('fail'));
});

gulp.task('styles', ['clean-styles', 'wiresass'], function () {
    log('Compiling Sass --> CSS');

    return gulp
        .src(config.sass)
        .pipe($.plumber())
        .pipe($.sass.sync())
        .pipe($.autoprefixer({
            browsers: ['last 2 version', '> 5%']
        }))
        .pipe($.plumber.stop())
        .pipe(gulp.dest(config.temp));
});

gulp.task('fonts', ['clean-fonts'], function () {
    log('Copying fonts');
    return gulp.src(config.fonts)
        .pipe(gulp.dest(config.build + 'fonts'));
});

gulp.task('images', ['clean-images'], function () {
    log('Copying and compressing the images');

    return gulp
        .src(config.images)
        .pipe($.imagemin({
            optimizationLevel: 4
        }))
        .pipe(gulp.dest(config.build + 'images'));
});

gulp.task('clean', function () {
    var delconfig = [].concat(config.build, config.temp);
    log('Cleaning: ' + $.util.colors.blue(delconfig));
    return del(delconfig);
});

gulp.task('clean-fonts', function () {
    clean(config.build + 'fonts/**/*.*');
});

gulp.task('clean-images', function () {
    clean(config.build + 'images/**/*.*');
});

gulp.task('clean-styles', function () {
    clean(config.temp + '**/*.css');
});

gulp.task('clean-code', function () {
    var files = [].concat(
        config.temp + '**/*.js',
        config.build + '**/*.html',
        config.build + 'js/**/*.js'
    );
    clean(files);
});

gulp.task('sasswatch', function () {
    gulp.watch([config.sass], ['styles']);
});

gulp.task('templatecache', ['clean-code'], function () {
    log('Creating AngularJS $templateCache');

    return gulp
        .src(config.htmltemplates)
        .pipe($.minifyHtml({
            empty: true
        }))
        .pipe($.angularTemplatecache(
            config.templateCache.file,
            config.templateCache.options
        ))
        .pipe(gulp.dest(config.temp));
});

gulp.task('wiresass', function () {
  var options = config.wiredepSass();
    var wiredep = require('wiredep').stream;
    log('Compiling Sass --> CSS');

    return gulp
        .src(config.sass)
        .pipe(wiredep(options))
        .pipe(gulp.dest(config.styles));
});

gulp.task('wiredep', function () {
    log('Wire bower css and js into index');
    var options = config.wiredepOptions();
    var wiredep = require('wiredep').stream;

    return gulp
        .src(config.index)
        .pipe(wiredep(options))
        .pipe($.inject(gulp.src(config.js)))
        .pipe(gulp.dest(config.client));
});

gulp.task('inject', ['wiredep', 'styles', 'templatecache'], function () {
    log('Wire our css into index and call wiredep');
    return gulp
        .src(config.index)
        .pipe($.inject(gulp.src(config.css)))
        .pipe(gulp.dest(config.client));
});

gulp.task('optimize', ['inject', 'fonts', 'images'], function () {
    log('Optimizing the javascript, css, html');

    var assets = $.useref.assets({
        searchPath: './'
    });
    var templateCache = config.temp + config.templateCache.file;
    var cssFilter = $.filter('**/*.css');
    var jsAppFilter = $.filter('**/' + config.optimized.app);
    var jsLibFilter = $.filter('**/' + config.optimized.lib);

    return gulp
        .src(config.index)
        .pipe($.plumber())
        .pipe($.inject(gulp.src(templateCache, {
            read: false
        }), {
            starttag: '<!-- inject:templates:js -->'
        }))
        .pipe(assets)
        .pipe(cssFilter)
        .pipe($.csso())
        .pipe(cssFilter.restore())
        .pipe(jsLibFilter)
        .pipe($.uglify())
        .pipe(jsLibFilter.restore())
        .pipe(jsAppFilter)
        .pipe($.ngAnnotate())
        .pipe($.uglify())
        .pipe(jsAppFilter.restore())
        .pipe($.rev())
        .pipe(assets.restore())
        .pipe($.useref())
        .pipe($.revReplace())
        .pipe(gulp.dest(config.build))
        .pipe($.rev.manifest())
        .pipe(gulp.dest(config.build));
});

/**
 * Bump the version
 * --type=pre will bump the prerelease version *.*.*-x
 * --type=patch or no flag will bump the patch version *.*.x
 * --type=minor will bump the minor version *.x.*
 * --type=major will bump the major version x.*.*
 * --version=1.2.3 will bump to a specific version and ignore other flags
 */
gulp.task('bump', function() {
    var msg = 'Bumping versions';
    var type = args.type;
    var version = args.version;
    var options = {};
    if (version) {
        options.version = version;
        msg += ' to ' + version;
    } else {
        options.type = type;
        msg += ' for a ' + type;
    }
    log(msg);

    return gulp
        .src(config.packages)
        .pipe($.print())
        .pipe($.bump(options))
        .pipe(gulp.dest(config.root));
});

gulp.task('serve-build', ['optimize'], function () {
    serve(false /* isDev */ );
});

gulp.task('serve-dev', ['inject'], function () {
    log('Serve development build');
    serve(true /* isDev */ );
});

// Functions //
function serve(isDev) {

    var nodeOptions = {
        script: config.nodeServer,
        delayTime: 1,
        env: {
            'PORT': port,
            'NODE_ENV': isDev ? 'dev' : 'build'
        },
        watch: [config.server]
    };

    return $.nodemon(nodeOptions)
        .on('restart', function (ev) {
            log('*** nodemon restarted');
            log('files changed on restart:\n' + ev);
            setTimeout(function () {
                browserSync.notify('reloading now ...');
                browserSync.reload({
                    stream: false
                });
            }, config.browserReloadDelay);
        })
        .on('start', function () {
            log('*** nodemon started');
            startBrowserSync(isDev);
        })
        .on('crash', function () {
            log('*** nodemon crashed: script crashed for some reason');
        })
        .on('exit', function () {
            log('*** nodemon exited cleanly');
        });
}

function changeEvent(event) {
    var srcPattern = new RegExp('/.*(?=/' + config.source + ')/');
    log('File ' + event.path.replace(srcPattern, '') + ' ' + event.type);
}

function startBrowserSync(isDev) {
    if (args.nosync || browserSync.active) {
        return;
    }

    log('Starting browser-sync on port ' + port);

    if (isDev) {
        gulp.watch([config.sass], ['styles'])
            .on('change', function (event) {
                changeEvent(event);
            });
    } else {
        gulp.watch([config.sass, config.js, config.html], ['optimize', browserSync.reload])
            .on('change', function (event) {
                changeEvent(event);
            });
    }


    var options = {
        proxy: 'localhost:' + port,
        port: 3000,
        files: isDev ? [
            config.client + '**/*.*',
            '!' + config.sass,
            config.temp + '**/*.css'
        ] : [],
        ghostMode: {
            clicks: true,
            location: false,
            forms: true,
            scroll: true
        },
        injectChanges: true,
        logFileChanges: true,
        logLevel: 'debug',
        logPrefix: 'iviixvii',
        notify: true,
        reloadDelay: 0 //1000
    };

    browserSync(options);
}

function clean(path) {
    log('Cleaning: ' + $.util.colors.blue(path));
    return del(path);
}

function log(msg) {
    if (typeof (msg) === 'object') {
        for (var item in msg) {
            if (msg.hasOwnProperty(item)) {
                $.util.log(colors.blue(msg[item]));
            }
        }
    } else {
        $.util.log(colors.blue(msg));
    }
}
