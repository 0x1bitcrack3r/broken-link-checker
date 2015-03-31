"use strict";
var linkObj    = require("./linkObj");
var parseLinks = require("./parseLinks");
var relativity = require("./relativity");
var resolve    = require("./resolve");

var request = require("request");



/*
	Call an event handler if it exists.
*/
function callHandler(handler, args, synchronous)
{
	if (typeof handler === "function")
	{
		if (args !== undefined)
		{
			if (Array.isArray(args) !== true)
			{
				args = [args];
			}
		}
		else
		{
			args = [];
		}
		
		if (synchronous === true)
		{
			handler.apply(null, args);
		}
		else
		{
			args.unshift(handler);
			
			setImmediate.apply(null, args);
		}
	}
}

callHandler.async = function(handler, args)
{
	callHandler(handler, args, false);
};

callHandler.sync = function(handler, args)
{
	callHandler(handler, args, true);
};



function checkHtml(html, options, handlers)
{
	var linkCount = 0;
	var resultCount = 0;
	
	parseLinks(html, options,
	{
		link: function(link)
		{
			linkCount++;
			
			checkUrl(link, options, function(result)
			{
				callHandler.sync(handlers.link, result);
				
				if (++resultCount >= linkCount)
				{
					callHandler.sync(handlers.complete, null);
				}
			});
		},
		complete: function()
		{
			// If no links found
			if (linkCount === 0)
			{
				callHandler.async(handlers.complete, null);
			}
		}
	});
}



function checkHtmlUrl(url, options, handlers)
{
	var resolvedUrl = resolve.url(url, options.base, options.acceptedSchemes);
	
	if (resolvedUrl === false)
	{
		callHandler.async(handlers.complete, invalidUrlError());
		return;
	}
	
	request(
	{
		headers: { "User-Agent":options.userAgent },
		url: resolvedUrl
	},
	function(error, response)
	{
		if (error !== null)
		{
			callHandler.async(handlers.complete, invalidUrlError(error));
		}
		else
		{
			if (response.headers["content-type"].indexOf("text/html") === 0)
			{
				// If URL was redirected
				if (response.request.href !== options.base)
				{
					// Duplicate options with new base
					options = Object.create(options);
					options.base = response.request.href;
				}
				
				checkHtml(response.body, options, handlers);
			}
			else
			{
				callHandler.sync(handlers.complete, new Error('expected type "text/html" but got "'+response.headers["content-type"]+'"'));
			}
		}
	});
}



function checkUrl(link, options, callback)
{
	if (typeof link === "string") link = linkObj(link);
	
	resolve.linkObj(link, options);
	
	if (link.url.resolved === null)
	{
		link.broken = true;
		link.error = invalidUrlError();
		linkObj.clean(link);
		callHandler.async(callback, link);
		return;
	}
	
	// Only requests header -- any body content is not downloaded
	request(
	{
		headers: { "User-Agent":options.userAgent },
		method: "HEAD",
		url: link.url.resolved
	},
	function(error, response)
	{
		var execution;
		
		if (error !== null)
		{
			link.broken = true;
			link.error = invalidUrlError(error);
			execution = "async";
		}
		else
		{
			link.broken = response.statusCode !== 200;
			
			link.http.redirects  = response.request.redirects;
			link.http.statusCode = response.statusCode;
			
			if (options.excludeResponseData !== true)
			{
				link.http.response = response;
			}
			
			if (link.url.resolved !== response.request.href)
			{
				link.url.redirected = response.request.href;
				
				if (link.base.resolved !== null)
				{
					link.internal = relativity.internal(link.base.parsed, response.request.uri);
					link.samePage = relativity.samePage(link.base.parsed, response.request.uri, link.internal);
				}
			}
			
			execution = "sync";
		}
		
		linkObj.clean(link);
		callHandler[execution](callback, link);
	});
}



/*
	Convert request.js "invalid uri" error to this library's version of the same
	for consistency.
	
	If different type of error, return original.
	If no error passed as input, return new error.
*/
function invalidUrlError(error)
{
	var createNew = true;
	
	if (error instanceof Error)
	{
		createNew = error.message.indexOf("Invalid URI") === 0;
	}
	
	if (createNew === true)
	{
		error = new Error("Invalid URL");
	}
	
	return error;
}



module.exports =
{
	html:    checkHtml,
	htmlUrl: checkHtmlUrl,
	url:     checkUrl
};
